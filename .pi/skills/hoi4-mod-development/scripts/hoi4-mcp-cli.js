#!/usr/bin/env node
"use strict";

/**
 * hoi4-mcp-cli — CLI for HOI4 modding tools.
 *
 * Usage:
 *   node hoi4-mcp-cli.js <tool_name> [--key value ...]
 *   node hoi4-mcp-cli.js map_get_province --province_id 123
 *   node hoi4-mcp-cli.js script_search --pattern "has_idea"
 *   node hoi4-mcp-cli.js --list
 *   node hoi4-mcp-cli.js --interactive
 *
 * Wraps MapMcpToolHandler from scripts/mcp/mapMcpServer.js
 */

const path = require('path');
const fs = require('fs');

// ── Resolve paths ────────────────────────────────────────────────────────────────

/** Walk up from cwd to find the repo root (where scripts/mcp/mapMcpServer.js lives) */
function findRepoRoot() {
  let current = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(current, 'scripts', 'mcp', 'mapMcpServer.js'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** Resolve the HOI4 mod content directory (has map/, history/, common/, ...)
 *
 *  In this project the repo root and mod content are different folders:
 *    BigLeninHistMod/          <-- repo root (scripts/, .pi/, opencode.json)
 *      └── BigLeninHistMod/    <-- mod content (common/, events/, map/, ...)
 *
 *  opencode.json passes "./BigLeninHistMod" to the server.
 */
function resolveModContent(repoRoot) {
  // 1) Is repoRoot itself the content?
  if (fs.existsSync(path.join(repoRoot, 'map', 'definition.csv')) || fs.existsSync(path.join(repoRoot, 'descriptor.mod'))) {
    return repoRoot;
  }

  // 2) Subdir named the same as repoRoot?
  const basename = path.basename(repoRoot);
  const sub1 = path.join(repoRoot, basename);
  if (fs.existsSync(path.join(sub1, 'map', 'definition.csv')) || fs.existsSync(path.join(sub1, 'descriptor.mod'))) {
    return sub1;
  }

  // 3) First subdirectory that has map/definition.csv
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(repoRoot, entry.name);
    if (fs.existsSync(path.join(candidate, 'map', 'definition.csv')) || fs.existsSync(path.join(candidate, 'descriptor.mod'))) {
      return candidate;
    }
  }

  // 4) Nothing found — return repoRoot (mapDataLoader will give a clear error)
  console.error('⚠️  Could not find mod content directory (map/definition.csv)');
  return repoRoot;
}

const REPO_ROOT = findRepoRoot();
if (!REPO_ROOT) {
  console.error('❌ mapMcpServer.js not found. Run this from the mod directory.');
  process.exit(1);
}

const MOD_CONTENT = resolveModContent(REPO_ROOT);

// ── Load server module ────────────────────────────────────────────────────────────

const mcpDir = path.join(REPO_ROOT, 'scripts', 'mcp');
const nmDir = path.join(mcpDir, 'node_modules');
if (fs.existsSync(nmDir) && !module.paths.includes(nmDir)) {
  module.paths.unshift(nmDir);
}

const server = require(path.join(mcpDir, 'mapMcpServer.js'));
const { MapMcpToolHandler, TOOLS } = server;
const { MapDataLoader } = require(path.join(mcpDir, 'mapDataLoader.js'));

// ── Init handler ──────────────────────────────────────────────────────────────────

let loader = null; try { loader = new MapDataLoader(MOD_CONTENT); } catch(e) { console.error("⚠️  Map init failed:", e.message); }
let handler = null; if (loader) { handler = new MapMcpToolHandler(loader); }

// ── CLI ───────────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log('HOI4 MCP CLI — tools for HOI4 modding\n');
  console.log('Usage:');
  console.log('  node hoi4-mcp-cli.js <tool_name> [--key value ...]');
  console.log('  node hoi4-mcp-cli.js --list          list available tools');
  console.log('  node hoi4-mcp-cli.js --list-json     JSON tool list');
  console.log('  node hoi4-mcp-cli.js --interactive   interactive mode');
  console.log('  node hoi4-mcp-cli.js --help          this help\n');
  console.log('Examples:');
  console.log('  node hoi4-mcp-cli.js map_get_summary');
  console.log('  node hoi4-mcp-cli.js map_get_province --province_id 123');
  console.log('  node hoi4-mcp-cli.js script_search --pattern "has_idea"');
  console.log('  node hoi4-mcp-cli.js loc_get --key STATE_1\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        const num = Number(next);
        if (!isNaN(num) && next !== '') {
          args[key] = num;
        } else if (next === 'true' || next === 'false') {
          args[key] = next === 'true';
        } else {
          args[key] = next;
        }
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  // --list
  if (args.includes('--list')) {
    console.log(`Mod content dir: ${MOD_CONTENT}\n`);
    console.log('Available tools:\n');
    for (const t of TOOLS) {
      const props = t.inputSchema?.properties;
      const params = props
        ? Object.keys(props)
            .map(k => k + (t.inputSchema.required?.includes(k) ? ' *' : ''))
            .join(', ')
        : '—';
      console.log(`  ${t.name}`);
      console.log(`    ${(t.description || '').slice(0, 120)}`);
      console.log(`    Parameters: ${params}\n`);
    }
    return;
  }

  // --list-json
  if (args.includes('--list-json')) {
    console.log(JSON.stringify({ modContent: MOD_CONTENT, tools: TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }))}, null, 2));
    return;
  }

  // --interactive
  if (args.includes('--interactive')) {
    console.log('🛠  HOI4 MCP Interactive CLI');
    console.log(`Mod content: ${MOD_CONTENT}`);
    console.log('Enter a tool name with parameters (or "exit" to quit).\n');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'hoi4> '
    });

    rl.prompt();

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') break;

      const parts = trimmed.split(/\s+/);
      const toolName = parts[0];
      const toolArgs = parseArgs(parts.slice(1));

      try {
  if (!handler) {
    console.error("❌ Handler not initialized (map tools unavailable)");
    console.log(JSON.stringify({error: "Map tools unavailable - no map/definition.csv found"}));
    process.exit(1);
  }
        console.error(`[~] ${toolName} ...`);
        const result = await handler.handle(toolName, toolArgs);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(`❌ ${err.message}`);
      }

      rl.prompt();
    }

    rl.close();
    return;
  }

  // ── Normal: tool_name [--key value ...] ──────────────────────────

  const toolName = args[0];
  const toolArgs = parseArgs(args.slice(1));

  const toolDef = TOOLS.find(t => t.name === toolName);
  if (!toolDef) {
    console.error(`❌ Unknown tool: "${toolName}"`);
    console.error(`   Use --list to see available tools.`);
    process.exit(1);
  }

  if (!handler) {
    console.error("❌ Handler not initialized (map tools unavailable)");
    console.log(JSON.stringify({error: "Map tools unavailable - no map/definition.csv found"}));
    process.exit(1);
  }
  console.error(`[~] ${toolName} ...`);

  try {
    const result = await handler.handle(toolName, toolArgs);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
