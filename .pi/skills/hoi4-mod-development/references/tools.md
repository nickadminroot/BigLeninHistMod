# Tools

## HOI4 MCP CLI (JavaScript)

### First-Time Setup

Install Node.js dependencies:

```bash
# Linux/macOS:
bash scripts/setup.sh

# Windows:
scripts\setup.bat

# Or manually:
cd scripts/mcp && npm install
```

Requires Node.js 18+ (https://nodejs.org/).

### Basic Usage

```bash
node scripts/hoi4-mcp-cli.js <tool_name> [--key value ...]
node scripts/hoi4-mcp-cli.js --interactive    # Interactive mode
node scripts/hoi4-mcp-cli.js --list           # List all tools
node scripts/hoi4-mcp-cli.js --help           # Help
```

**Parameter types:**
- String: `--key "value"`
- Number: `--key 123`
- Boolean: `--key true` / `--key false`
- Array: `--key [1,2,3]`
- Object: `--key '{"a":1}'`

### Script Tools

**Search across mod files:**
```bash
node scripts/hoi4-mcp-cli.js script_search --pattern "has_idea"
node scripts/hoi4-mcp-cli.js script_search --pattern "country_event" --file_pattern "events/"
node scripts/hoi4-mcp-cli.js script_search --pattern "TAG_focus" --case_sensitive true --max_results 20
```

**Find definitions:**
```bash
node scripts/hoi4-mcp-cli.js script_get_definitions --type focus
node scripts/hoi4-mcp-cli.js script_get_definitions --type idea --query "SOV_"
node scripts/hoi4-mcp-cli.js script_get_definitions --type event --query "hl2"
```

**Find references:**
```bash
node scripts/hoi4-mcp-cli.js script_get_references --name "TAG_my_focus"
node scripts/hoi4-mcp-cli.js script_get_references --name "SOV_new_spirit"
```

**Parse file:**
```bash
node scripts/hoi4-mcp-cli.js script_parse_file --file "events/hl2_events.txt"
node scripts/hoi4-mcp-cli.js script_parse_file --file "common/national_focus/SOV.txt" --max_depth 3
```

**Validate file:**
```bash
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/achievements.txt"
node scripts/hoi4-mcp-cli.js script_validate_file --file "events/hl2_events.txt"
```

**Scope context:**
```bash
node scripts/hoi4-mcp-cli.js script_get_scope_context --file "common/national_focus/SOV.txt" --line 50
```

**Look up effects/triggers/modifiers:**
```bash
node scripts/hoi4-mcp-cli.js script_lookup_effect --name "add_political_power"
node scripts/hoi4-mcp-cli.js script_lookup_effect --search "stability"
node scripts/hoi4-mcp-cli.js script_lookup_effect --search "war" --type_filter trigger
node scripts/hoi4-mcp-cli.js script_lookup_effect --name "add_ideas" --scope_filter country
```

### Localization Tools

**Search loc keys:**
```bash
node scripts/hoi4-mcp-cli.js loc_search --query "SOV_"
node scripts/hoi4-mcp-cli.js loc_search --query "industry" --language english
node scripts/hoi4-mcp-cli.js loc_search --query "завод" --language russian
```

**Get a key's value:**
```bash
node scripts/hoi4-mcp-cli.js loc_get --key "STATE_1"
node scripts/hoi4-mcp-cli.js loc_get --key "SOV_fascism"
```

**Validate localization:**
```bash
node scripts/hoi4-mcp-cli.js loc_validate
node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true
node scripts/hoi4-mcp-cli.js loc_validate --check_unused true   # slow
```

**Set a loc key (creates file with BOM):**
```bash
node scripts/hoi4-mcp-cli.js loc_set --key "my_event.1.t" --value "Event Title"
node scripts/hoi4-mcp-cli.js loc_set --key "my_event.1.t" --value "Event Title" --file "localisation/english/my_events_l_english.yml"
node scripts/hoi4-mcp-cli.js loc_set --key "my_event.1.t" --value "Название события" --language russian
```

**Set multiple keys:**
```bash
node scripts/hoi4-mcp-cli.js loc_bulk_set --entries '[{"key":"my_focus","value":"My Focus"},{"key":"my_focus_desc","value":"Description"}]'
node scripts/hoi4-mcp-cli.js loc_bulk_set --entries '[{"key":"my_focus","value":"Мой фокус"},{"key":"my_focus_desc","value":"Описание"}]' --language russian
```

### Mod Structure Tools

```bash
node scripts/hoi4-mcp-cli.js mod_get_structure
node scripts/hoi4-mcp-cli.js mod_get_file --file "common/national_focus/SOV.txt"
node scripts/hoi4-mcp-cli.js mod_get_file --file "events/hl2_events.txt" --start_line 10 --end_line 50
```

---

## Smoke Test

### Windows

```bash
python scripts/hoi4-smoke-windows.py
```

**Environment variables (all optional — auto-detected):**
| Variable | Default | Description |
|----------|---------|-------------|
| `HOI4_DIR` | Auto-detected | HOI4 installation path |
| `PDX_USER_DIR` | Auto-detected | Paradox user data path |
| `SMOKE_TIMEOUT` | `300s` | Game launch timeout (supports s/m/h/d) |
| `SMOKE_TAG` | `GER` | Country to play during smoke test |
| `SMOKE_INCLUDE_PATTERN` | (none) | Regex filter for error entries |
| `SMOKE_MAX_ERROR_ENTRIES` | `40` | Max errors to display |
| `HOI4_SMOKE_KEEP_DATA` | `0` | Set `1` to keep temp dir |
| `HOI4_SMOKE_CREAM_UNLOCKALL` | `1` | Set `0` to disable CreamAPI unlock |
| `PDX_SMOKE_HOME` | (temp) | Fixed smoke home directory |

**What it does:**
1. Backs up launcher metadata
2. Temporarily enables only this mod
3. Optionally unlocks DLC via CreamAPI
4. Launches HOI4 in headless/debug mode
5. Waits for game to initialize
6. Checks `logs/error.log` for new errors
7. Reports pass/fail

### Cross-Platform (Linux / macOS / Windows)

```bash
# From the skill directory:
python scripts/hoi4-smoke.py

# Or from your mod directory (if scripts are in PATH):
python /path/to/skill/scripts/hoi4-smoke.py
```

Auto-detects HOI4 installation. Uses `start_new_session=True` and `os.killpg` on Linux/macOS, `CREATE_NEW_PROCESS_GROUP` and `taskkill` on Windows.

### Windows-Specific (with CreamAPI)

```bash
python scripts/hoi4-smoke-windows.py
```

Same auto-detection, plus CreamAPI DLC unlock support.

### Smoke Test Output

- **PASS** — No new errors in error.log
- **FAIL** — New errors found, reported with file:line references

**Investigating failures:**
```bash
# Check the error log directly:
cat ~/Documents/Paradox\ Interactive/Hearts\ of\ Iron\ IV/logs/error.log

# Filter for mod-specific errors:
grep "BigLeninHistMod\|MyMod" ~/Documents/Paradox\ Interactive/Hearts\ of\ Iron\ IV/logs/error.log
```

---

## Merge Vanilla

When you need to compare your mod against vanilla or merge vanilla changes:

### Universal (All Platforms)

```bash
# From the skill directory:
python scripts/merge-vanilla.py
python scripts/merge-vanilla.py --dry-run    # Preview without changes
```

**Environment variables (all optional — auto-detected):**
| Variable | Default | Description |
|----------|---------|-------------|
| `HOI4_DIR` | Auto-detected | HOI4 installation path |
| `PDX_USER_DIR` | Auto-detected | Paradox user data path |
| `MOD_DIR` | Current directory | Mod directory to update |

**What it does:**
1. Parses `replace_path` from `descriptor.mod`
2. Finds corresponding vanilla directories in HOI4 installation
3. Copies vanilla files into mod for replaced paths
4. Creates `.bak` backups of existing files
5. Reports what was updated

**When to use:**
- After a HOI4 game update to sync vanilla changes
- When starting a new mod that replaces many vanilla paths
- To compare your mod files against vanilla originals

---

## Validation Workflow

Full validation sequence:

```bash
# 1. Validate script files
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/national_focus/TAG.txt"
node scripts/hoi4-mcp-cli.js script_validate_file --file "events/TAG_events.txt"
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/decisions/TAG.txt"

# 2. Validate localization
node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true

# 3. Check for broken references
node scripts/hoi4-mcp-cli.js script_get_references --name "TAG_new_spirit"

# 4. Run smoke test
python scripts/hoi4-smoke.py              # Cross-platform
# OR
python scripts/hoi4-smoke-windows.py      # Windows with CreamAPI

# 5. Check error.log
cat ~/Documents/Paradox\ Interactive/Hearts\ of\ Iron\ IV/logs/error.log
```

---

## Debug Helpers

### debug_smoke.py

Quick helper to analyze error.log:

```bash
python scripts/debug_smoke.py
```

Parses error.log, filters known-ignored files, and shows matching errors.

### fix_errors.py

Batch fix known errors by removing invalid lines:

```bash
python scripts/fix_errors.py
```

Edit the script to add your specific error patterns before running.

### Focus Ordering Fix

```bash
python scripts/fix_focus_ordering.py
```

Reorders focuses in focus tree files to fix visual layout issues.

### SteamCMD Workshop Upload

```bash
# Session-based (first time: manual login creates session):
python scripts/hoi4_workshop_upload.py --login USER --password PASS

# Subsequent runs (session preserved):
python scripts/hoi4_workshop_upload.py --login USER

# With .env file:
python scripts/hoi4_workshop_upload.py

# Preview only:
python scripts/hoi4_workshop_upload.py --dry-run
python scripts/hoi4_workshop_upload.py --vdf-only
```

**First-time setup:**
1. Install SteamCMD to `D:/SteamCMD/` or set `STEAMCMD_PATH`
2. Create `.env` file (see `.env.example`)
3. Run: `python scripts/hoi4_workshop_upload.py`
4. If Steam Guard mobile authenticator: confirm on phone when prompted
5. Upload proceeds after confirmation

**Steam Guard mobile authenticator:** Requires phone confirmation on EVERY login. This is normal — session files don't bypass it. For full automation, use an account without mobile authenticator.

---

## MCP Server

For interactive use, the MCP server provides the same tools via protocol:

```bash
# Start MCP server:
node scripts/mcp/hoi4-mcp-server.js

# Or use via CLI wrapper:
node scripts/hoi4-mcp-cli.js --interactive
```
