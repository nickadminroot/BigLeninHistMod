#!/usr/bin/env node
"use strict";

/**
 * hoi4-mcp-cli — quiet CLI client with a persistent, worktree-scoped daemon.
 *
 * Each absolute mod-content path gets its own daemon and in-memory index. The
 * daemon fully invalidates that index after filesystem changes settle, and
 * exits automatically after an idle timeout.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PROTOCOL_VERSION = 1;
const CHANGE_DEBOUNCE_MS = Number(process.env.HOI4_MCP_DEBOUNCE_MS) || 750;
const IDLE_TIMEOUT_MS = Number(process.env.HOI4_MCP_IDLE_MS) || 15 * 60 * 1000;
const START_TIMEOUT_MS = Number(process.env.HOI4_MCP_START_TIMEOUT_MS) || 10 * 1000;

function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, 'scripts', 'mcp', 'mapMcpServer.js'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function isModContent(candidate) {
  return fs.existsSync(path.join(candidate, 'map', 'definition.csv')) ||
    fs.existsSync(path.join(candidate, 'descriptor.mod'));
}

function resolveModContent(repoRoot) {
  if (isModContent(repoRoot)) return repoRoot;

  const sameName = path.join(repoRoot, path.basename(repoRoot));
  if (isModContent(sameName)) return sameName;

  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const candidate = path.join(repoRoot, entry.name);
      if (isModContent(candidate)) return candidate;
    }
  }

  throw new Error('Could not find mod content directory (descriptor.mod or map/definition.csv)');
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch (_) {
    return resolved;
  }
}

function daemonEndpoint(modContent) {
  const identity = process.platform === 'win32'
    ? canonicalPath(modContent).toLowerCase()
    : canonicalPath(modContent);
  const hash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\hoi4-mcp-${hash}`
    : path.join(os.tmpdir(), `hoi4-mcp-${hash}.sock`);
}

function loadRuntime(repoRoot, modContent) {
  const mcpDir = path.join(repoRoot, 'scripts', 'mcp');
  const nmDir = path.join(mcpDir, 'node_modules');
  if (fs.existsSync(nmDir) && !module.paths.includes(nmDir)) module.paths.unshift(nmDir);

  const { MapMcpToolHandler, TOOLS } = require(path.join(mcpDir, 'mapMcpServer.js'));
  const { MapDataLoader } = require(path.join(mcpDir, 'mapDataLoader.js'));
  return {
    TOOLS,
    createHandler: () => new MapMcpToolHandler(new MapDataLoader(modContent))
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    if (next === 'true' || next === 'false') {
      args[key] = next === 'true';
    } else if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(next)) {
      args[key] = Number(next);
    } else if ((next.startsWith('[') && next.endsWith(']')) ||
               (next.startsWith('{') && next.endsWith('}')) || next === 'null') {
      try { args[key] = JSON.parse(next); } catch (_) { args[key] = next; }
    } else {
      args[key] = next;
    }
    i++;
  }
  return args;
}

function printUsage() {
  console.log('HOI4 MCP CLI — persistent tools for HOI4 modding\n');
  console.log('Usage:');
  console.log('  node scripts/hoi4-mcp-cli.js <tool_name> [--key value ...]');
  console.log('  node scripts/hoi4-mcp-cli.js --list');
  console.log('  node scripts/hoi4-mcp-cli.js --interactive');
  console.log('  node scripts/hoi4-mcp-cli.js --stop-daemon');
  console.log('  node scripts/hoi4-mcp-cli.js <tool_name> --no-daemon --verbose\n');
  console.log('The default daemon is isolated by absolute mod/worktree path, fully');
  console.log('reindexes after debounced file changes, and exits after 15 idle minutes.');
}

function sendRequest(endpoint, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = '';
    let settled = false;

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => { buffer += chunk; });
    socket.on('error', err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    socket.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(buffer.trim()));
      } catch (err) {
        reject(new Error(`Invalid daemon response: ${err.message}`));
      }
    });
  });
}

function isConnectionError(err) {
  return ['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET'].includes(err && err.code);
}

function spawnDaemon(repoRoot, modContent) {
  const child = spawn(process.execPath, [
    __filename,
    '--daemon',
    '--repo-root', repoRoot,
    '--mod-content', modContent
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

async function requestDaemon(repoRoot, modContent, request) {
  const endpoint = daemonEndpoint(modContent);
  try {
    return await sendRequest(endpoint, request);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
  }

  spawnDaemon(repoRoot, modContent);
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      return await sendRequest(endpoint, request);
    } catch (err) {
      lastError = err;
      if (!isConnectionError(err)) throw err;
    }
  }
  throw new Error(`Daemon did not start within ${START_TIMEOUT_MS}ms: ${lastError?.message || 'unknown error'}`);
}

function snapshotFileSignatures(root) {
  const signatures = new Map();
  const visit = (absolute, relative) => {
    let entries;
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        visit(childAbsolute, childRelative);
      } else {
        try {
          const stat = fs.statSync(childAbsolute);
          const key = process.platform === 'win32' ? childRelative.toLowerCase() : childRelative;
          signatures.set(key, `${stat.size}:${stat.mtimeMs}`);
        } catch (_) { /* file disappeared during the snapshot */ }
      }
    }
  };
  visit(root, '');
  return signatures;
}

async function runDaemon(repoRoot, modContent) {
  const endpoint = daemonEndpoint(modContent);
  const runtime = loadRuntime(repoRoot, modContent);
  const fileSignatures = snapshotFileSignatures(modContent);
  let handler = null;
  let generation = 0;
  let changeTimer = null;
  let settlePromise = null;
  let settleResolve = null;
  let watcher = null;
  let idleTimer = null;
  let queue = Promise.resolve();

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS);
  }

  function refreshSignatures() {
    const fresh = snapshotFileSignatures(modContent);
    let changed = fresh.size !== fileSignatures.size;
    if (!changed) {
      for (const [key, value] of fresh) {
        if (fileSignatures.get(key) !== value) { changed = true; break; }
      }
    }
    if (changed) {
      fileSignatures.clear();
      for (const [key, value] of fresh) fileSignatures.set(key, value);
    }
    return changed;
  }

  function scheduleInvalidation() {
    clearTimeout(changeTimer);
    if (!settlePromise) {
      settlePromise = new Promise(resolve => { settleResolve = resolve; });
    }
    changeTimer = setTimeout(() => {
      handler = null;
      generation++;
      const resolve = settleResolve;
      settlePromise = null;
      settleResolve = null;
      if (resolve) resolve();
    }, CHANGE_DEBOUNCE_MS);
  }

  async function waitForSettledChanges() {
    while (settlePromise) await settlePromise;
  }

  async function dispatch(request) {
    if (!request || request.protocol !== PROTOCOL_VERSION) {
      throw new Error('CLI/daemon protocol version mismatch; stop the old daemon and retry');
    }
    if (request.type === 'ping') return { pid: process.pid, modContent, generation };
    if (request.type === 'stop') {
      setImmediate(shutdown);
      return { stopped: true, pid: process.pid };
    }
    if (request.type !== 'call') throw new Error(`Unknown daemon request type: ${request.type}`);

    const toolDef = runtime.TOOLS.find(tool => tool.name === request.toolName);
    if (!toolDef) throw new Error(`Unknown tool: "${request.toolName}"`);

    await waitForSettledChanges();
    if (!handler) handler = runtime.createHandler();
    const started = Date.now();
    const result = await handler.handle(request.toolName, request.args || {});
    return { result, durationMs: Date.now() - started, generation };
  }

  function shutdown() {
    clearTimeout(idleTimer);
    clearTimeout(changeTimer);
    if (watcher) watcher.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }

  try {
    watcher = fs.watch(modContent, { recursive: true }, (_event, filename) => {
      const relative = String(filename || '');
      const normalized = relative.replace(/\\/g, '/');
      if (normalized.includes('/.git/') || normalized.startsWith('.git/')) return;
      if (!relative) {
        if (refreshSignatures()) scheduleInvalidation();
        return;
      }

      const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
      const oldSignature = fileSignatures.get(key);
      let newSignature = null;
      try {
        const stat = fs.statSync(path.join(modContent, relative));
        if (stat.isDirectory()) {
          if (refreshSignatures()) scheduleInvalidation();
          return;
        }
        newSignature = `${stat.size}:${stat.mtimeMs}`;
      } catch (_) { /* deletion or atomic rename */ }

      if (newSignature === oldSignature) return;
      if (newSignature === null) fileSignatures.delete(key);
      else fileSignatures.set(key, newSignature);
      scheduleInvalidation();
    });
  } catch (_) {
    // Recursive watching is available on supported Windows installations. The
    // daemon remains usable without invalidation on unsupported filesystems.
  }

  if (process.platform !== 'win32' && fs.existsSync(endpoint)) {
    try { fs.unlinkSync(endpoint); } catch (_) { /* another daemon may own it */ }
  }

  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let input = '';
    let accepted = false;
    socket.on('data', chunk => {
      input += chunk;
      if (accepted || !input.includes('\n')) return;
      accepted = true;
      clearTimeout(idleTimer);
      const line = input.slice(0, input.indexOf('\n')).trim();
      queue = queue.then(async () => {
        clearTimeout(idleTimer);
        try {
          const value = await dispatch(JSON.parse(line));
          socket.end(`${JSON.stringify({ ok: true, ...value })}\n`);
        } catch (err) {
          socket.end(`${JSON.stringify({ ok: false, error: err.message })}\n`);
        } finally {
          resetIdleTimer();
        }
      }).catch(() => {});
    });
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') process.exit(0);
    process.exit(1);
  });
  server.listen(endpoint, resetIdleTimer);
}

async function runDirect(repoRoot, modContent, toolName, toolArgs, verbose) {
  const originalError = console.error;
  if (!verbose) console.error = () => {};
  try {
    const runtime = loadRuntime(repoRoot, modContent);
    if (!runtime.TOOLS.some(tool => tool.name === toolName)) throw new Error(`Unknown tool: "${toolName}"`);
    return await runtime.createHandler().handle(toolName, toolArgs);
  } finally {
    console.error = originalError;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const internalArgs = parseArgs(argv);

  if (argv.includes('--daemon')) {
    if (!internalArgs['repo-root'] || !internalArgs['mod-content']) throw new Error('Missing daemon paths');
    await runDaemon(canonicalPath(internalArgs['repo-root']), canonicalPath(internalArgs['mod-content']));
    return;
  }

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) throw new Error('mapMcpServer.js not found. Run this from the mod repository.');
  const modContent = resolveModContent(repoRoot);
  const verbose = argv.includes('--verbose');

  if (argv.includes('--stop-daemon')) {
    try {
      const response = await sendRequest(daemonEndpoint(modContent), { protocol: PROTOCOL_VERSION, type: 'stop' });
      if (!response.ok) throw new Error(response.error);
      if (verbose) console.error(`[hoi4-cli] stopped daemon ${response.pid}`);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      if (verbose) console.error('[hoi4-cli] no daemon is running');
    }
    return;
  }

  if (argv.includes('--list') || argv.includes('--list-json')) {
    const runtime = loadRuntime(repoRoot, modContent);
    if (argv.includes('--list-json')) {
      console.log(JSON.stringify({ modContent, tools: runtime.TOOLS }, null, 2));
    } else {
      for (const tool of runtime.TOOLS) console.log(tool.name);
    }
    return;
  }

  if (argv.includes('--interactive')) {
    console.error(`HOI4 MCP CLI (${modContent}) — enter "exit" to quit`);
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'hoi4> ' });
    rl.prompt();
    for await (const line of rl) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) { if (!rl.closed) rl.prompt(); continue; }
      if (parts[0] === 'exit' || parts[0] === 'quit') break;
      try {
        const response = await requestDaemon(repoRoot, modContent, {
          protocol: PROTOCOL_VERSION, type: 'call', toolName: parts[0], args: parseArgs(parts.slice(1))
        });
        if (!response.ok) throw new Error(response.error);
        console.log(JSON.stringify(response.result, null, 2));
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
      if (!rl.closed) rl.prompt();
    }
    if (!rl.closed) rl.close();
    return;
  }

  const toolName = argv[0];
  if (toolName.startsWith('--')) throw new Error(`Unknown option: ${toolName}`);
  const toolArgs = parseArgs(argv.slice(1).filter(arg => !['--no-daemon', '--verbose'].includes(arg)));

  if (verbose) console.error(`[hoi4-cli] ${toolName} (${argv.includes('--no-daemon') ? 'one-shot' : 'daemon'})`);
  let result;
  if (argv.includes('--no-daemon')) {
    result = await runDirect(repoRoot, modContent, toolName, toolArgs, verbose);
  } else {
    const response = await requestDaemon(repoRoot, modContent, {
      protocol: PROTOCOL_VERSION, type: 'call', toolName, args: toolArgs
    });
    if (!response.ok) throw new Error(response.error);
    result = response.result;
    if (verbose) console.error(`[hoi4-cli] completed in ${response.durationMs}ms (generation ${response.generation})`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
