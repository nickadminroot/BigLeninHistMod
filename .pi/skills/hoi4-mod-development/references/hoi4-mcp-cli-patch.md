# hoi4-mcp-cli.js Patch for Translation Submods

## Problem

`hoi4-mcp-cli.js` requires `map/definition.csv` to identify the mod content directory. Translation submods (localisation-only) don't have map files, so `loc_validate` and `loc_search` fail with "Could not find mod content directory".

## Fix

Patch `hoi4-mcp-cli.js` in the skill's scripts directory:

### 1. Add `descriptor.mod` check to `resolveModContent()`

```javascript
function resolveModContent(repoRoot) {
  // 1) Is repoRoot itself the content? (check definition.csv OR descriptor.mod)
  if (fs.existsSync(path.join(repoRoot, 'map', 'definition.csv')) ||
      fs.existsSync(path.join(repoRoot, 'descriptor.mod'))) {
    return repoRoot;
  }

  // 2) Subdir named the same as repoRoot?
  const basename = path.basename(repoRoot);
  const sub1 = path.join(repoRoot, basename);
  if (fs.existsSync(path.join(sub1, 'map', 'definition.csv')) ||
      fs.existsSync(path.join(sub1, 'descriptor.mod'))) {
    return sub1;
  }

  // 3) First subdirectory that has definition.csv OR descriptor.mod
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(repoRoot, entry.name);
    if (fs.existsSync(path.join(candidate, 'map', 'definition.csv')) ||
        fs.existsSync(path.join(candidate, 'descriptor.mod'))) {
      return candidate;
    }
  }

  // 4) Nothing found — return repoRoot
  console.error('⚠️  Could not find mod content directory (map/definition.csv or descriptor.mod)');
  return repoRoot;
}
```

### 2. Make MapDataLoader optional

```javascript
let loader = null;
let handler = null;
try {
  loader = new MapDataLoader(MOD_CONTENT);
  handler = new MapMcpToolHandler(loader);
} catch (e) {
  console.error('⚠️  MapDataLoader init failed (map tools unavailable):', e.message);
}
```

### 3. Add handler null check before tool execution

```javascript
if (!handler) {
  console.error("❌ Handler not initialized (map tools unavailable)");
  console.log(JSON.stringify({error: "Map tools unavailable - no map/definition.csv found"}));
  process.exit(1);
}
```

## Usage After Patch

```bash
# For translation submods (no map files):
cd MyTranslationMod
node scripts/hoi4-mcp-cli.js loc_validate
node scripts/hoi4-mcp-cli.js loc_search --query "TODO"
```
