# AGENTS.md - BigLeninHistMod

## Project Overview
This is vanilla-like multiplayer oriented historical modification for Hearts of Iron IV with strong emphasis on balance and optimization.

## Project Structure

- `./vanilla/documentation/` - Documentation about modding for HOI4. **Read this regularly.**
- `./vanilla/` - Vanilla game files the mod is based on.
- `./BigLeninHistMod/` - Shipped mod files. This is the folder published to Steam Workshop.
- `./scripts/` - Local development and validation scripts. These are repository tooling and should not be shipped to Steam Workshop.

Agents should modify shipped game/mod content only in `./BigLeninHistMod/` and its subfolders. Repository tooling, documentation, and agent instructions may be modified outside that folder when the task explicitly concerns tooling or workflow.

---

## Local Smoke Test

Use `scripts/hoi4-smoke.py` to launch the locally installed HOI4 binary with this mod enabled in an isolated Paradox user-data directory, then fail if `logs/error.log` contains startup/load errors.

Run from the repository root:

```bash
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

Mod files should mirror the structure of `vanilla/common/`:

| Folder | Purpose |
|--------|---------|
| `common/ideas/` | National ideas, economic/military ideas |
| `common/national_focus/` | Focus trees |
| `common/decisions/` | Decisions and their conditions/effects |
| `common/technologies/` | Tech tree definitions |
| `common/characters/` | Historical leaders, portraits, traits |
| `common/countries/` | Country definitions (tags, colors) |
| `common/scripted_triggers/` | Reusable trigger conditions |
| `common/scripted_effects/` | Reusable effect blocks |
| `common/scripted_guis/` | Custom GUI logic |
| `common/modifiers/` | Modifier definitions |
| `common/dynamic_modifiers/` | Time-varying modifiers |
| `common/technologies/` | Technology categories and items |
| `common/doctrines/` | Military doctrines |
| `common/operations/` | Espionage operations |
| `common/factions/` | Faction definitions |
| `common/occupation_laws/` | Occupation policy rules |
| `common/resistance_activity/` | Resistance mechanics |
| `events/` | Event files (country-specific and generic) |
| `localisation/` | Language files (e.g., `english.yml`) |
| `map/` | Terrain, strategic regions, states |
| `history/countries/` | Historical country data (starting divisions, factories) |
| `history/states/` | State-level history (owner, buildings, resources) |

---

## File Locations Reference

- **Triggers Reference**: `vanilla/documentation/triggers_documentation.md`
- **Effects Reference**: `vanilla/documentation/effects_documentation.md`
- **Modifiers Reference**: `vanilla/documentation/modifiers_documentation.md`
- **Script Concepts**: `vanilla/documentation/script_concept_documentation.md`
- **Localization**: `vanilla/documentation/loc_objects_documentation.md`
- **Dynamic Variables**: `vanilla/documentation/dynamic_variables_documentation.md`

### Example Files
- Events: `vanilla/events/` - Study event syntax (id, picture, options, title, desc)
- Ideas: `vanilla/common/ideas/` - Example idea definitions
- National Focus: `vanilla/common/national_focus/` - Focus tree structure
- Characters: `vanilla/common/characters/` - Character definitions

---

## Modding Best Practices

1. **Use vanilla as reference**: Always check `vanilla/common/` files for correct syntax before writing new code.

2. **Use scripted triggers/effects**: Define reusable logic in `common/scripted_triggers/` and `common/scripted_effects/` to avoid repetition.

3. **Use localization**: Never hardcode text. Use `localisation/` files with proper keys:
   ```pdx
   # In event:
   title = event_123_title
   desc = event_123_desc
   
   # In english.yml:
   event_123_title: "Title Here"
   event_123_desc: "Description here."
   ```

4. **Follow naming conventions**: Use consistent prefixes (e.g., `my_mod_idea`, `event_5000`).

5. **Test incrementally**: Make small changes and test frequently in-game.

6. **Use flags for state tracking**: Instead of variables, use `set_country_flag` / `has_country_flag` for persistent state.

7. **Check documentation**: The `vanilla/documentation/` folder contains detailed info on triggers, effects, modifiers, and scripting features.
