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
- Events: `vanilla/events/` - Study event syntax (id, picture, options, title, desc)
- Ideas: `vanilla/common/ideas/` - Example idea definitions
- National Focus: `vanilla/common/national_focus/` - Focus tree structure
- Characters: `vanilla/common/characters/` - Character definitions

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

9. **Check documentation**: `vanilla/documentation/` contains detailed reference material. Use the MCP `hoi4-mcp_script_lookup_effect` tool for quick syntax lookups.

10. **Verify BOM on localization**: After writing `.yml` files, ensure UTF-8 BOM encoding.
