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

### 9. Focus costs are not set properly

Remember that focuses have cost = N where N is the number of weeks (7 days) - not the number of days. For example, a focus with cost = 1 week will cost 7 days to complete.  

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
