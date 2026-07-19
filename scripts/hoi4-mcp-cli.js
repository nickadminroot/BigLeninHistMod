#!/usr/bin/env node
"use strict";

/**
 * hoi4-mcp-cli — reliable one-shot CLI for HOI4 modding tools.
 *
 * Normal calls run in their own process and exit after one tool invocation.
 * Interactive mode deliberately reuses one in-process handler, but there is no
 * background daemon, socket, file watcher, or cross-command process state.
 */

const path = require('path');
const fs = require('fs');

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
    if (!entry.isDirectory()) continue;
    const candidate = path.join(repoRoot, entry.name);
    if (isModContent(candidate)) return candidate;
  }

  throw new Error('Could not find mod content directory (descriptor.mod or map/definition.csv)');
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

const MOD_PATH_FIELDS = {
  script_parse_file: ['file'],
  script_validate_file: ['file'],
  script_get_scope_context: ['file'],
  mod_get_file: ['file'],
  loc_set: ['file'],
  loc_bulk_set: ['file'],
  gui_parse_gfx: ['file'],
  gui_parse_gui: ['file'],
  gui_validate: ['gui_file'],
  gui_generate_gfx: ['directory', 'output_file']
};

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeModPath(value, modContent, cwd) {
  if (typeof value !== 'string' || value.length === 0) return value;

  let candidate;
  if (path.isAbsolute(value)) {
    candidate = path.resolve(value);
  } else if (/^\.\.?[\\/]/.test(value)) {
    candidate = path.resolve(cwd, value);
  } else {
    const cwdCandidate = path.resolve(cwd, value);
    const modCandidate = path.resolve(modContent, value);
    candidate = fs.existsSync(cwdCandidate) ? cwdCandidate : modCandidate;
  }

  if (!isInsidePath(modContent, candidate)) {
    throw new Error(`Path is outside the mod content directory: ${value}`);
  }
  return path.relative(modContent, candidate) || '.';
}

function normalizeToolArgs(toolName, args, modContent, cwd = process.cwd()) {
  const fields = MOD_PATH_FIELDS[toolName];
  if (!fields) return args;

  const normalized = { ...args };
  for (const field of fields) {
    if (normalized[field] !== undefined) {
      normalized[field] = normalizeModPath(normalized[field], modContent, cwd);
    }
  }
  return normalized;
}

function printUsage() {
  console.log('HOI4 MCP CLI — reliable one-shot tools for HOI4 modding\n');
  console.log('Usage:');
  console.log('  node scripts/hoi4-mcp-cli.js <tool_name> [--key value ...]');
  console.log('  node scripts/hoi4-mcp-cli.js --list');
  console.log('  node scripts/hoi4-mcp-cli.js --list-json');
  console.log('  node scripts/hoi4-mcp-cli.js --interactive');
  console.log('  node scripts/hoi4-mcp-cli.js --help\n');
  console.log('Normal calls execute once and exit; no daemon is started.');
  console.log('File arguments may be mod-relative, absolute paths inside mod content,');
  console.log('or existing paths relative to the current working directory.');
}

async function callQuietly(handler, toolName, toolArgs, verbose) {
  const originalError = console.error;
  if (!verbose) console.error = () => {};
  try {
    return await handler.handle(toolName, toolArgs);
  } finally {
    console.error = originalError;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) throw new Error('mapMcpServer.js not found. Run this from the mod repository.');
  const modContent = resolveModContent(repoRoot);
  const verbose = argv.includes('--verbose');
  const runtime = loadRuntime(repoRoot, modContent);

  if (argv.includes('--stop-daemon')) {
    if (verbose) console.error('[hoi4-cli] daemon mode has been removed; nothing to stop');
    return;
  }

  if (argv.includes('--list') || argv.includes('--list-json')) {
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
    const handler = runtime.createHandler();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'hoi4> ' });
    rl.prompt();

    for await (const line of rl) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) {
        if (!rl.closed) rl.prompt();
        continue;
      }
      if (parts[0] === 'exit' || parts[0] === 'quit') break;

      try {
        const toolName = parts[0];
        if (!runtime.TOOLS.some(tool => tool.name === toolName)) {
          throw new Error(`Unknown tool: "${toolName}"`);
        }
        const toolArgs = normalizeToolArgs(toolName, parseArgs(parts.slice(1)), modContent);
        const started = Date.now();
        const result = await callQuietly(handler, toolName, toolArgs, verbose);
        if (verbose) console.error(`[hoi4-cli] completed in ${Date.now() - started}ms`);
        console.log(JSON.stringify(result, null, 2));
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
  if (!runtime.TOOLS.some(tool => tool.name === toolName)) {
    throw new Error(`Unknown tool: "${toolName}"`);
  }

  // --no-daemon remains accepted as a compatibility no-op for older commands.
  const parsedToolArgs = parseArgs(argv.slice(1).filter(arg => !['--no-daemon', '--verbose'].includes(arg)));
  const toolArgs = normalizeToolArgs(toolName, parsedToolArgs, modContent);
  const handler = runtime.createHandler();
  const started = Date.now();
  if (verbose) console.error(`[hoi4-cli] ${toolName} (one-shot)`);
  const result = await callQuietly(handler, toolName, toolArgs, verbose);
  if (verbose) console.error(`[hoi4-cli] completed in ${Date.now() - started}ms`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
