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
