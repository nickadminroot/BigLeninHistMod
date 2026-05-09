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

---

## Console Commands (Testing)

Useful console commands for testing (press `~` in-game):

- `tag TAG` - Switch to another country
- `event ID` - Trigger an event
- `fow` - Toggle fog of war
- `nocb` - Instant country formation
- `tdebug` - Debug tooltips
- `research all` - Unlock all tech
- `add_equipment` - Add equipment to stockpile
- `add_manpower` - Add manpower

See `vanilla/documentation/console_commands_documentation.md` for full list.

---

## Generating Focus Icons

### Single Icon Generation

Use `scripts/generate-single-focus-icon.py` to generate a custom focus icon via ComfyUI (Z-Image GGUF model). The script handles the full pipeline: generation, background removal, transparent margin cropping, alpha hole filling, DDS conversion, and .gfx registration.

**Prerequisites:**
- ComfyUI running on `http://127.0.0.1:8188`
- `rembg` Python package installed (`pip install rembg`)
- Z-Image GGUF model available in ComfyUI (`z-image-Q8_0.gguf`)

**Usage:**

```bash
python3 scripts/generate-single-focus-icon.py \
  --sprite-name "GFX_focus_custom_MY_FOCUS_ID" \
  --desc "A Soviet T-34 tank breaking through a shattered defensive line, artillery flashes in the background, red banner rising behind the tank"
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `--sprite-name` | Yes | GFX sprite name. Must start with `GFX_focus_custom_`. The part after this prefix becomes the DDS filename. |
| `--desc` | Yes | Description of the central image/object. Be specific — name concrete objects, not abstract concepts. |
| `--seed` | No | Random seed (0=random). Use a fixed seed to reproduce results. |
| `--steps` | No | Sampler steps (default: 35). |
| `--cfg` | No | CFG scale (default: 4.0). |
| `--ai-size` | No | Generation resolution (default: 512). Use 1024 for higher quality. |
| `--force` | No | Regenerate even if DDS already exists. |

**What the script does:**
1. Generates a 512x512 (or 1024x1024) image via ComfyUI using Z-Image GGUF
2. Removes background with `rembg`
3. Crops transparent margins at full resolution (preserves detail)
4. Fills internal alpha holes (prevents cutouts inside the icon)
5. Downsizes to 100x88 and converts to DDS (ARGB8888, no compression)
6. Appends a `SpriteType` entry to `BigLeninHistMod/interface/custom_focus_icons.gfx`

**Writing good descriptions:**

Each description should describe **ONE concrete visual object** — not abstract concepts. The model generates better results when given specific, visualizable subjects.

| Bad (abstract) | Good (concrete) |
|----------------|-----------------|
| "preparation for winter, equipment, snow" | "a steel M35 helmet covered in thick snow and icicles hanging from the brim" |
| "final blow, artillery attack, battle" | "a 150mm howitzer firing, muzzle flash and powder smoke" |
| "victory or death, decisive attack" | "a military banner with an Iron Cross, fabric tearing in the wind" |
| "supply routes, logistics" | "a long freight train with tanker cars crossing a railway bridge" |

**Description template:**
```
[Theme name]. Central image: [concrete object 1], [concrete object 2], [background element].
```

Example:
```
Operation Bagration. Central image: a Soviet T-34 tank breaking through a shattered enemy defensive line, with a torn front-line map beneath it, artillery flashes in the background, and a red banner rising behind the tank.
```

**After generation:**
- The DDS file is saved to `BigLeninHistMod/gfx/interface/goals/focus_custom_{ID}.dds`
- The .gfx entry is appended to `BigLeninHistMod/interface/custom_focus_icons.gfx`
- Reference the icon in a focus definition: `icon = GFX_focus_custom_MY_FOCUS_ID`

### Batch Icon Generation

For generating many icons at once, use `scripts/generate-zimage-focus-icons.py`. It reads focus IDs from `focuses.txt` and generates icons for all pending ones.

```bash
# Check what's already generated vs pending
python3 scripts/generate-zimage-focus-icons.py --list-done
python3 scripts/generate-zimage-focus-icons.py --list-pending

# Generate a batch of 5 icons
python3 scripts/generate-zimage-focus-icons.py --batch-size 5

# Continue from a specific position
python3 scripts/generate-zimage-focus-icons.py --batch-start 10 --batch-size 5

# Regenerate specific icons with new descriptions
python3 scripts/generate-zimage-focus-icons.py --force --ids "FOCUS_ID_1,FOCUS_ID_2"

# Rebuild .gfx from all existing DDS files
python3 scripts/generate-zimage-focus-icons.py --build-gfx
```

Each icon takes ~4 minutes to generate. Run in batches of 5-10 to avoid timeouts.
