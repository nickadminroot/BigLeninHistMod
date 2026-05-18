# AGENTS.md - BigLeninHistMod

## Project Overview
Vanilla-like multiplayer oriented historical modification for Hearts of Iron IV with strong emphasis on balance and optimization.

## Project Structure

- `./vanilla/documentation/` - Documentation about modding for HOI4. **Read this regularly.**
- `./vanilla/` - Vanilla game files the mod is based on.
- `./BigLeninHistMod/` - Shipped mod files published to Steam Workshop.
- `./scripts/` - Local development and validation scripts (not shipped).

Agents should modify shipped game/mod content only in `./BigLeninHistMod/` and its subfolders. Repository tooling, documentation, and agent instructions may be modified outside that folder when the task explicitly concerns tooling or workflow.

---

## Local Smoke Test

Quick validation after changes:

```bash
python3 scripts/hoi4-smoke.py          # Linux
python scripts\hoi4-smoke-windows.py   # Windows
```

Environment variables: `HOI4_DIR`, `SMOKE_TIMEOUT` (default 60s/120s), `SMOKE_TAG` (default GER), `SMOKE_INCLUDE_PATTERN`, `SMOKE_MAX_ERROR_ENTRIES` (default 40).

The Windows variant backs up and restores `dlc_load.json`/`mod/BigLeninHistMod.mod`/`cream_api.ini`, enables only this mod, and by default unlocks all DLC. Entries from `common/units/infantry.txt` and `common/decisions/USA.txt` are ignored. See script source for full details.

---

## MCP Server (HOI4 Map Tools)

`scripts/mcp/mapMcpServer.js` provides **43 tools** across 5 categories via Model Context Protocol. Run `npm install` in `scripts/mcp/` after cloning.

### Tool Categories

| Category   | Count | Key Tools |
|------------|-------|-----------|
| **GUI**    | 6     | `gui_create_scripted_gui`, `gui_parse_gui`, `gui_parse_gfx`, `gui_validate` |
| **Loc**    | 5     | `loc_set`, `loc_bulk_set`, `loc_get`, `loc_search`, `loc_validate` |
| **Map**    | 26    | `map_get_state`, `map_edit_state`, `map_search_states`, `map_render_snapshot`, `map_transfer_provinces`, `map_create_state`, `map_validate` |
| **Script** | 7     | `script_get_definitions`, `script_get_references`, `script_lookup_effect`, `script_validate_file`, `script_search` |
| **Mod**    | 2     | `mod_get_file`, `mod_get_structure` |

All prefixed with `hoi4-mcp_` (e.g., `hoi4-mcp_map_get_state`). Use these for map edits, localization, code search, and validation instead of raw file manipulation.
python3 scripts/hoi4-smoke.py
```

Configuration:
- `HOI4_DIR` - Override the installed game path. Defaults to `$HOME/.steam/steam/steamapps/common/Hearts of Iron IV`.
- `SMOKE_TIMEOUT` - How long to let HOI4 run before `timeout` stops it. Defaults to `60s`; timeout exit code `124` is acceptable. The script launches HOI4 in a separate process group and kills that process group on timeout, with `timeout --kill-after=10s` as a fallback.
- `SMOKE_TAG` - Start country tag. Defaults to `GER`.
- `PDX_SMOKE_HOME` - Use a fixed isolated temp/user-data root for debugging. When set, data is retained.
- `HOI4_SMOKE_KEEP_DATA=1` - Keep generated logs and temp user data after the run.
- `SMOKE_MAX_ERROR_ENTRIES` - Maximum parsed error entries to print on failure. Defaults to `40`.
- `SMOKE_MAX_ENTRY_LINES` - Maximum lines to print for each error entry. Defaults to `8`.
- `SMOKE_INCLUDE_PATTERN` - Optional regex to limit which `error.log` entries are treated as failures. When unset, every parsed `error.log` entry is treated as actionable unless its source file is hardcoded as ignored.

The script seeds the isolated user-data directory from the normal profile's DLC state (`dlc_load.json`, `dlc_signature`, and `game_data.json` when present), then writes a temporary `mod/BigLeninHistMod.mod` and enables only this mod. If the installed game directory has an executable `cream.sh`, the script launches through it to match the local normal DLC-enabled start path; otherwise it launches `run_hoi4` directly. Launch stdout/stderr is captured to `hoi4-launch.log` inside the smoke temp directory instead of being printed by default, so agent-facing output stays concise. Entries sourced from `common/units/infantry.txt` and `common/decisions/USA.txt` are hardcoded as ignored. It does not modify normal Paradox launcher state.

### Windows Smoke Test

Use `scripts/hoi4-smoke-windows.py` on Windows. It launches `hoi4.exe` from the local Steam install, temporarily enables only this mod in the normal Paradox user-data directory, and fails if the updated `logs/error.log` contains startup/load errors.

Run from the repository root in PowerShell:

```powershell
python scripts\hoi4-smoke-windows.py
```

Configuration:
- `HOI4_DIR` - Override the installed game path. Defaults to `G:\SteamLibrary\steamapps\common\Hearts of Iron IV`.
- `PDX_USER_DIR` - Override the normal Paradox user-data directory. Defaults to the repository's parent HOI4 user-data directory, usually `D:\Documents\Paradox Interactive\Hearts of Iron IV`.
- `SMOKE_TIMEOUT` - How long to let HOI4 run before `taskkill /T /F` stops it. Defaults to `120s`; timeout exit code `124` is acceptable.
- `SMOKE_TAG` - Start country tag. Defaults to `GER`.
- `PDX_SMOKE_HOME` - Use a fixed temp root for retained launch logs and crash data. When set, data is retained.
- `HOI4_SMOKE_KEEP_DATA=1` - Keep generated temp launch logs and crash data after the run.
- `HOI4_SMOKE_CREAM_UNLOCKALL` - Temporarily set `unlockall = true` in `cream_api.ini` while the smoke test runs. Defaults to `1`. Set to `0` to leave `cream_api.ini` unchanged.
- `SMOKE_MAX_ERROR_ENTRIES` - Maximum parsed error entries to print on failure. Defaults to `40`.
- `SMOKE_MAX_ENTRY_LINES` - Maximum lines to print for each error entry. Defaults to `8`.
- `SMOKE_INCLUDE_PATTERN` - Optional regex to limit which `error.log` entries are treated as failures. When unset, every parsed `error.log` entry is treated as actionable unless its source file is hardcoded as ignored.

Important Windows behavior: the current Windows HOI4 binary writes logs to the normal user-data directory even when a separate `-userdir` is attempted, so the Windows script intentionally uses the normal `PDX_USER_DIR`. Before launch it backs up `dlc_load.json`, `mod/BigLeninHistMod.mod`, and `cream_api.ini`; writes temporary versions that enable only this mod and, by default, unlock all DLC through CreamAPI; then restores the originals in `finally`. The script checks that `logs/error.log` was actually updated by the current run before parsing it. Launch stdout/stderr is captured to `hoi4-launch.log` inside the temp smoke directory. Entries sourced from `common/units/infantry.txt` and `common/decisions/USA.txt` are hardcoded as ignored.

---

## MCP Server (HOI4 Map Tools)

The MCP server at `scripts/mcp/mapMcpServer.js` provides 43 tools for HOI4 modding via the Model Context Protocol. The server code and its dependencies (`mapDataLoader.js`, `clausewitzMcp.js`, `imageToMap.js`) are checked into the repository. Run `npm install` in `scripts/mcp/` after cloning to install dependencies (`@modelcontextprotocol/sdk`, `sharp`).

### GUI Tools (6)

| Tool | Description |
|---|---|
| `hoi4-mcp_gui_create_scripted_gui` | Generate scripted GUI definition file with window_name, visible trigger, effect/property blocks |
| `hoi4-mcp_gui_generate_gfx` | Generate .gfx spriteType entries for DDS textures from a directory |
| `hoi4-mcp_gui_get_sprites` | Search and list all sprite definitions across the mod |
| `hoi4-mcp_gui_parse_gfx` | Parse a .gfx file — return all spriteTypes with names, textures, animations |
| `hoi4-mcp_gui_parse_gui` | Parse a .gui file — return element tree with positions, sizes, sprites |
| `hoi4-mcp_gui_validate` | Validate GUI/GFX: sprite references exist, textures on disk |

### Localization Tools (5)

| Tool | Description |
|---|---|
| `hoi4-mcp_loc_bulk_set` | Bulk-write localization key-value pairs (for events, focuses, decisions) |
| `hoi4-mcp_loc_get` | Get a localization key's value in all available languages |
| `hoi4-mcp_loc_search` | Search localization keys and values by pattern |
| `hoi4-mcp_loc_set` | Write/update a single localization key-value pair |
| `hoi4-mcp_loc_validate` | Validate localization: missing keys, unused keys, language gaps |

### Map Tools (26)

| Tool | Description |
|---|---|
| `hoi4-mcp_map_bulk_edit` | Perform multiple map edit operations in one call (with backup) |
| `hoi4-mcp_map_create_backup` | Create a manual backup of all map files |
| `hoi4-mcp_map_create_state` | Create a new state from province list (auto-removes from old states) |
| `hoi4-mcp_map_edit_province` | Edit province properties: type, terrain, coastal, continent |
| `hoi4-mcp_map_edit_railway` | Add/remove/update railway level |
| `hoi4-mcp_map_edit_state` | Edit state properties: owner, manpower, category, resources, buildings, cores |
| `hoi4-mcp_map_edit_strategic_region` | Edit strategic region: name, provinces, naval terrain |
| `hoi4-mcp_map_edit_supply_node` | Add or remove supply hub |
| `hoi4-mcp_map_edit_victory_point` | Add/update/remove victory point (VP = 0 removes) |
| `hoi4-mcp_map_generate_from_image` | Generate full HOI4 map from image (provinces.bmp, definition.csv, states, etc.) |
| `hoi4-mcp_map_get_adjacencies` | Get provinces adjacent to a given province (with border pixels) |
| `hoi4-mcp_map_get_countries` | List all countries with TAG and color; detailed info per country |
| `hoi4-mcp_map_get_province` | Full province info: RGB, type, terrain, coastal, continent, VP, etc. |
| `hoi4-mcp_map_get_state` | Full state data: name, owner, manpower, category, provinces, resources, cores |
| `hoi4-mcp_map_get_strategic_region` | Strategic region data: name, provinces, naval terrain, center |
| `hoi4-mcp_map_get_summary` | High-level map statistics: dimensions, province/state/region counts |
| `hoi4-mcp_map_get_supply_network` | Railways and supply hubs (filterable by state/province/bbox) |
| `hoi4-mcp_map_get_terrain_info` | Available terrain types and their distribution |
| `hoi4-mcp_map_preview_image_regions` | Preview image-to-province splitting WITHOUT generating files |
| `hoi4-mcp_map_render_ascii` | ASCII-art visualization of a map area (states/provinces/terrain) |
| `hoi4-mcp_map_render_minimap` | Full minimap at low resolution with highlighted areas |
| `hoi4-mcp_map_render_snapshot` | Render PNG of a map area (political/terrain/manpower/industry/VP) with zoom, labels, railways |
| `hoi4-mcp_map_render_state_view` | Focused render of one state with provinces, neighbors, railways, details |
| `hoi4-mcp_map_search_provinces` | Search provinces by criteria (type, terrain, coastal, continent, state, VP, adjacency) |
| `hoi4-mcp_map_search_states` | Search states by criteria (owner, category, resources, manpower, cores, VP) |
| `hoi4-mcp_map_transfer_provinces` | Move provinces between states (with backup) |
| `hoi4-mcp_map_validate` | Validate map: orphan provinces, missing data, disconnected railways |

### Script Tools (7)

| Tool | Description |
|---|---|
| `hoi4-mcp_script_get_definitions` | Find all definitions of a given type (event/focus/decision/idea/technology/character) |
| `hoi4-mcp_script_get_references` | Find all references to an identifier across all .txt files |
| `hoi4-mcp_script_get_scope_context` | Determine scope context (country/state/character) at a given line |
| `hoi4-mcp_script_lookup_effect` | Look up effect/trigger/modifier: scope, parameters, description, syntax, examples |
| `hoi4-mcp_script_parse_file` | Parse a .txt file into structured AST (blocks, key-value, comments) |
| `hoi4-mcp_script_search` | Regex search across all mod files (like grep) |
| `hoi4-mcp_script_validate_file` | Validate Clausewitz script syntax: brackets, undefined refs, missing loc |

### Mod Tools (2)

| Tool | Description |
|---|---|
| `hoi4-mcp_mod_get_file` | Read any mod file with line numbers and range support |
| `hoi4-mcp_mod_get_structure` | Get project structure: file counts by category, lines of code, file sizes |

---

## HOI4 Modding Key Concepts

### Triggers
Triggers are conditions that check the game state. They return true/false and are used in `if`, `limit`, `allow`, and similar blocks.

Common scopes: `COUNTRY`, `STATE`, `CHARACTER`, `FACTION`, `any`

Examples:
- `has_idea = my_idea` - Check if country has an idea
- `is_in_faction = yes` - Check faction membership
- `date > 1936.1.1` - Date conditions
- `any_owned_state = { is_core_of = ROOT }` - Loop through states
- `hidden_trigger = { ... }` - Hidden condition that doesn't show in tooltips

See `vanilla/documentation/triggers_documentation.md` for full reference.

### Effects
Effects are actions that change the game state. They perform operations like adding ideas, declaring wars, or triggering events.

Common scopes: `COUNTRY`, `STATE`, `CHARACTER`, `any`

Examples:
- `add_idea = my_idea` - Add national idea
- `declare_war_on = { target = TAG type = annex_wargoal }` - Declare war
- `country_event = { id = 123 }` - Trigger event
- `set_country_flag = my_flag` - Set a flag
- `add_to_faction = TAG` - Add to faction

See `vanilla/documentation/effects_documentation.md` for full reference.

### Modifiers
Modifiers are stat adjustments applied to countries, states, or units. They are used in ideas, national foci, and dynamic modifiers.

Categories:
- `country` - National modifiers (production, research, etc.)
- `state` - Regional modifiers (industry, resources, etc.)
- `army`/`air`/`naval` - Military unit modifiers
- `ai` - AI behavior modifiers

Examples:
- `production_speed_industrial_complex_factor = 0.15`
- `army_attack_factor = 0.1`
- `research_speed_factor = 0.1`

See `vanilla/documentation/modifiers_documentation.md` for full reference.

### Collections
Collections provide an efficient way to filter and transform game objects without explicit loops.

```pdx
collection_size = {
    input = {
        input = game:scope
        operators = { faction_members owned_states }
        name = "States owned by any faction member"
    }
    value > 42
}
```

Available inputs: `game:all_countries`, `game:all_states`, `game:all_possible_countries`, `collection:NAME`

See `vanilla/documentation/script_collection_input.md` and `vanilla/documentation/script_collection_operator.md`.

### Script Constants
Reusable constants defined in `vanilla/common/script_constants/` that can be used across mod files.

```pdx
# In script_constants file:
numeric_constants = {
    pi = 3.14159
}

# Usage:
some_variable = constant:numeric_constants.pi
```

### Dynamic Variables
Runtime variable storage. See `vanilla/documentation/dynamic_variables_documentation.md`.

---

## Common File Types

Files in `./BigLeninHistMod/` mirror `./vanilla/common/`:

| Folder | Purpose |
|--------|---------|
| `common/ideas/` | National ideas, spirits, laws (`country = { }`, `hidden_ideas = { }`) |
| `common/national_focus/` | Focus trees |
| `common/decisions/` | Decisions and conditions/effects |
| `common/technologies/` | Tech tree definitions |
| `common/characters/` | Leaders, portraits, traits |
| `common/countries/` | Country definitions (tags, colors) |
| `common/scripted_triggers/` | Reusable trigger conditions |
| `common/scripted_effects/` | Reusable effect blocks |
| `common/modifiers/` | Modifier definitions |
| `common/dynamic_modifiers/` | Changing in realtime modifiers with variable values |
| `common/doctrines/` | Military doctrines |
| `common/operations/` | Espionage operations |
| `events/` | Event files |
| `localisation/` | Language `.yml` files |
| `history/countries/` | Starting divisions, factories |
| `history/states/` | State ownership, buildings, resources |

---

## File Locations Reference

- **Triggers**: `vanilla/documentation/triggers_documentation.md`
- **Effects**: `vanilla/documentation/effects_documentation.md`
- **Modifiers**: `vanilla/documentation/modifiers_documentation.md`
- **Script Concepts**: `vanilla/documentation/script_concept_documentation.md`
- **Localization**: `vanilla/documentation/loc_objects_documentation.md`
- **Dynamic Variables**: `vanilla/documentation/dynamic_variables_documentation.md`

### Example Files
- Events: `vanilla/events/`
- Ideas: `vanilla/common/ideas/`
- National Focus: `vanilla/common/national_focus/`
- Characters: `vanilla/common/characters/`

---

## Common Mistakes

### 1. Hidden Ideas vs Country Ideas (Display)

Ideas in `hidden_ideas = { }` are **invisible** in the national spirit UI. Players won't see them. Use `country = { }` for visible national spirits.

```
WRONG (idea invisible):
ideas = { hidden_ideas = { my_national_spirit = { modifier = { ... } } } }

CORRECT (idea visible in UI):
ideas = { country = { my_national_spirit = { modifier = { ... } } } }
```

**When to use each:**
- `country = { }` — national spirits that should display in the idea slot UI
- `hidden_ideas = { }` — only for purely mechanical modifiers that need no player visibility (e.g., equipment_bonus tracking flags, AI-weight modifiers). Always set `allowed = { always = no }` and `removal_cost = -1` so they can only be added/removed via effects.

### 2. Static Ideas vs Dynamic Modifiers

This is a critical distinction that agents frequently confuse.

| Aspect | Static Idea | Dynamic Modifier |
|--------|-------------|------------------|
| **Defined in** | `common/ideas/*.txt` | `common/dynamic_modifiers/*.txt` |
| **Added via** | `add_idea = name` | `add_dynamic_modifier = { modifier = name scope = TAG days = N }` |
| **Removed via** | `remove_idea = name` | Auto-removes after `days`, or via `remove_trigger` |
| **Values** | Fixed constants | Can reference variables (e.g., `factory_output = my_variable`) |
| **Persistence** | Permanent until removed | Temporary (timed) |
| **UI** | Visible as national spirit | Hidden or custom tooltip |
| **Update** | Immediate | Daily only (use `force_update_dynamic_modifier` to force) |

**Static idea example** (`common/ideas/GER.txt`):
```pdx
ideas = {
    country = {
        general_staff = {
            allowed = { original_tag = GER }
            removal_cost = -1
            modifier = {
                army_org_factor = 0.05
                planning_speed = 0.25
            }
        }
    }
}
```

**Dynamic modifier example** (`common/dynamic_modifiers/0_dynamic_modifiers.txt`):
```pdx
BUL_foreign_industry_dynamic_modifier = {
    enable = { always = yes }
    icon = GFX_idea_man_five_year_plan_industry
    political_power_gain = 0.05
    production_speed_buildings_factor = BUL_foreign_industry_construction_speed_modifier
    consumer_goods_factor = BUL_foreign_industry_consumer_goods_modifier
}
```
Note: modifier values can reference **variables** (`BUL_foreign_industry_construction_speed_modifier`), which static ideas cannot.

Applied in script:
```pdx
add_dynamic_modifier = {
    modifier = BUL_foreign_industry_dynamic_modifier
    scope = ROOT
    days = 365
}
```

**Static ideas support** `modifier = { }`, `equipment_bonus = { }`, `rule = { }`, `research_bonus = { }` — any permanent or toggleable effect with fixed values. This includes `country = { }` (national spirits), `hidden_ideas = { }` (invisible trackers), `economy`/`trade_laws`/`mobilization_laws` (law categories), `army_spirit`/`air_spirit`/`navy_spirit` (spirit slots).

**Dynamic modifiers** can only use plain `modifier = { }` values (NOT `equipment_bonus`). Use them for: timed auto-removing effects, value-scaling via variables, effects with `remove_trigger`, combat-only via `attacker_modifier = yes`, state-scoped effects.

### 3. equipment_bonus — Only in Static Ideas, Three Key Types

`equipment_bonus = { }` modifies equipment stats (build_cost_ic, reliability, armor, speed, etc.). It **only works in static ideas** (`common/ideas/*.txt`) — never in dynamic modifiers, which don't support equipment bonuses.

The block accepts three distinct key types:

| Type | Prefix | Targets | Example |
|------|--------|---------|---------|
| **Specific equipment** | (none) | Exact one equipment type | `infantry_equipment`, `heavy_tank_chassis` |
| **Built-in archetypes** | (none) | Game-defined group | `armor`, `screen_ship`, `carrier` |
| **MIO categories** | `mio_cat_eq_` | Custom group from `common/equipment_groups/` | `mio_cat_eq_all_tanks` |

```
# Specific equipment names (in country idea):
equipment_bonus = {
    artillery_equipment = { instant = yes build_cost_ic = -0.1 }
}

# Built-in archetype (all armored vehicles):
equipment_bonus = {
    armor = { soft_attack = 0.03 }
}

# MIO category (all small planes):
equipment_bonus = {
    mio_cat_eq_all_small_plane = { instant = yes build_cost_ic = -0.05 }
}
```

Rules:
- Use `instant = yes` for build_cost_ic changes — without it, the cost only updates daily
- `equipment_bonus` works in BOTH `country = { }` (visible) and `hidden_ideas = { }` (invisible)
- Can apply penalties too (positive `build_cost_ic = 0.1` increases cost)
- For naval archetypes (`screen_ship`, `capital_ship`), properties like `naval_speed`/`naval_range` do NOT need `instant = yes`
- See `vanilla/common/equipment_groups/_documentation.md` for group definitions

### 4. swap_ideas for Upgrading Static Ideas

When a national spirit needs improvement (e.g., focus tree upgrade), **do not** keep piling modifiers into one idea. Use `swap_ideas` to atomically replace the old idea with a new one.

```
WRONG (stacking modifiers in one idea, fragile):
modifier = {
    factory_output = 0.05  # base
    factory_output = 0.10  # upgraded via some focus — conflicts!
}

CORRECT (clean upgrade via swap):
# base idea in ideas file:
basic_industry = { modifier = { factory_output = 0.05 } }

# upgraded idea in ideas file:
improved_industry = { modifier = { factory_output = 0.10 } }

# in focus complete effect:
swap_ideas = {
    remove_idea = basic_industry
    add_idea = improved_industry
}
```

This pattern is used **1058+ times** in the mod (e.g., in `germany.txt`, `spain.txt`). The vanilla game does not use `swap_ideas` — it's a mod-specific effect.

Tip: wrap in `effect_tooltip = { ... }` for player clarity, and guard with `if = { limit = { has_idea = basic_industry } }` when the idea may not exist.

### 5. Vanilla File Location (Worktree)

This repo is a **git worktree**. Vanilla reference files are always available:

1. **Primary**: `./vanilla/` — directly in the repo root
2. **Fallback**: check `../../BigLeninHistMod/vanilla/` (main repo, one directory up)
3. **Parent directory**: `../` contains the full worktree set

If a vanilla file isn't found, **do not** guess the path. Look in these locations first. The most common cause is looking in the wrong directory — the repo structure is:
```
mod/BigLeninHistMod/          # worktree (this repo root)
mod/BigLeninHistMod/vanilla/  # vanilla files HERE
mod/BigLeninHistMod/BigLeninHistMod/  # shipped mod content
```

### 6. UTF-8 BOM in Localization Files

`.yml` files in `localisation/` **must** be saved as UTF-8 with BOM (byte order mark: `EF BB BF`). Plain UTF-8 without BOM causes encoding errors in HOI4.

Always verify BOM after writing `.yml` files. Use the MCP `hoi4-mcp_loc_set`/`hoi4-mcp_loc_bulk_set` tools — they handle BOM automatically.

### 7. Update ALL Localization Keys

When adding effects or modifiers with localization keys, update **every** referenced key. Partial updates leave missing text in game. Use `hoi4-mcp_loc_bulk_set` for batch updates.

### 8. File Integrity & Git Awareness

- Before editing, run `git status` and `git diff` to understand current state
- If a file gets accidentally damaged, immediately use `git restore <file>`
- After changes, run `git diff` to verify only intended lines changed
- The mod is under active development — stale context leads to mistakes. Always re-read files before editing.

---

## Modding Best Practices

1. **Use vanilla as reference**: Always check `vanilla/common/` files for correct syntax.

2. **Use scripted triggers/effects**: Define reusable logic in `common/scripted_triggers/` and `common/scripted_effects/`.

3. **Use localization**: Never hardcode text. Use `localisation/` files:
   ```pdx
   # In event:
   title = event_123_title
   desc = event_123_desc
   # In english.yml:
   event_123_title: "Title Here"
   ```

4. **Follow naming conventions**: Use consistent prefixes (e.g., `my_mod_idea`, `event_5000`).

5. **Test incrementally**: Make small changes, run smoke test, check `error.log`.

6. **Use flags for state tracking**: Prefer `set_country_flag` / `has_country_flag` over variables.

7. **Re-read files before editing**: The mod is large and constantly changing. Never rely on stale context — use `hoi4-mcp_mod_get_file` to re-read files from disk.

8. **Use `swap_ideas` for idea upgrades**: Don't stack modifiers — create separate idea variants and swap.

7. **Check documentation**: The `vanilla/documentation/` folder contains detailed info on triggers, effects, modifiers, and scripting features.
