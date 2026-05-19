# AGENTS.md - BigLeninHistMod

## Mission

BigLeninHistMod is a vanilla-like, multiplayer-oriented historical HOI4 mod focused on balance and performance.

Modify shipped game content only under `BigLeninHistMod/` unless the task explicitly concerns scripts, tooling, or agent docs.

## Before Editing

1. Use `rg` for search. Use the HOI4 MCP CLI (`scripts/hoi4-mcp-cli.js`) for script, mod, and localization operations (see sections below). Map and GUI tools live in pi skills (`/skill:hoi4-map`, `/skill:hoi4-gui`).
2. Use local vanilla references before guessing.

Indexed documentation corpus (git-tracked, survives worktrees): `docs/rag/corpus/`

Relevant files there:
- `effects_documentation.md`, `triggers_documentation.md`, `modifiers_documentation.md`
- `loc_objects_documentation.md`, `loc_formatter_documentation.md`
- `console_commands_documentation.md`, `dynamic_variables_documentation.md`
- `script_concept_documentation.md`, `script_collection_*.md`
- `collections_documentation.md`, `decisions_documentation.md`, `doctrines_*.md`
- `equipment_groups_documentation.md`, `factions_documentation.md`
- `intelligence_agency_upgrades_documentation.md`
- `military_industrial_organization_*.md`
- `on_actions_documentation.md`, `operations_documentation.md`
- `operation_phases_documentation.md`, `operation_tokens_documentation.md`
- `peace_conference_*.md`, `resources_documentation.md`
- `units_equipment_documentation.md`

## Localization Rules

- `.yml` localization files must be UTF-8 with BOM.
- Every new or changed visible key needs English and Russian localization when both folders contain related files.
- Focus names use `<focus_id>` and descriptions use `<focus_id>_desc`.
- Idea names use `<idea_id>` and descriptions use `<idea_id>_desc`.
- Custom tooltips are normal loc keys, usually ending in `_tt`.
- If a focus has `custom_effect_tooltip`, `custom_trigger_tooltip`, `complete_tooltip`, or a hand-written `_tt` loc key, update it whenever the actual effect changes.

## Focus Basics

Focus files live in `BigLeninHistMod/common/national_focus/`.

Typical focus shape:

```pdx
focus = {
	id = TAG_focus_id
	icon = GFX_goal_generic_construct_civilian
	prerequisite = { focus = TAG_parent_focus }
	x = 0
	y = 1
	relative_position_id = TAG_parent_focus
	cost = 5
	ai_will_do = { factor = 1 }
	search_filters = { FOCUS_FILTER_INDUSTRY }
	completion_reward = {
		add_political_power = 50
	}
}
```

Vanilla defines `FOCUS_POINT_DAYS = 7`, so `cost = 10` is about 70 days and `cost = 5` is about 35 days.

## How To Change Focus Duration

1. Find the focus by `id = TAG_focus_id`.
2. Change only its `cost = N`. Remember that N is weeks, not days.

## How To Delete A Focus

1. Add `allow_branch = { always = no }` to the focus block, or if it already has `allow_branch = { ... }` replace it with with `allow_branch = { always = no }`.

## How To Add A Modifier To A Focus

Prefer a static national spirit unless the effect must be variable-driven.

### Static National Spirit

1. Add or update an idea in `BigLeninHistMod/common/ideas/<country>.txt`.
2. Put visible national spirits inside `ideas = { country = { ... } }`, not `hidden_ideas` or something else.
3. Use `allowed = { always = no }`, `allowed_civil_war = { always = yes }`, and `removal_cost = -1` for focus-granted spirits.
4. Add `picture = ...` using an existing vanilla/mod idea icon.
5. Add localization for the idea name and desc.
6. Grant it in the focus:

```pdx
completion_reward = {
	add_ideas = TAG_new_spirit
}
```

Idea template:

```pdx
ideas = {
	country = {
		TAG_new_spirit = {
			allowed = { always = no }
			allowed_civil_war = { always = yes }
			removal_cost = -1
			picture = generic_production_bonus

			modifier = {
				industrial_capacity_factory = 0.05
			}
		}
	}
}
```

### Upgrading An Existing Spirit

Do not stack duplicate modifier values in one idea. Create a new idea variant and swap it:

```pdx
completion_reward = {
	if = {
		limit = { has_idea = TAG_old_spirit }
		swap_ideas = {
			remove_idea = TAG_old_spirit
			add_idea = TAG_new_spirit
		}
	}
}
```

Use the same localized name for old/new variants when the UI should show "Modify <spirit>" style behavior. Update any custom tooltip that describes the upgrade.

### `modifier = {}` vs `equipment_bonus = {}`

- `modifier = {}` changes country/state/unit stats such as `industrial_capacity_factory`, `army_org_factor`, `research_speed_factor`, `production_speed_industrial_complex_factor`.
- `equipment_bonus = {}` changes equipment stats such as `build_cost_ic`, reliability, armor, speed, attack, range. It only belongs in static ideas, not dynamic modifiers.
- `equipment_bonus` keys can target exact equipment (`infantry_equipment`), built-in archetypes (`armor`, `screen_ship`, `carrier`), or MIO equipment groups (`mio_cat_eq_all_tanks`).
- Use `instant = yes` for `build_cost_ic` changes so production cost updates immediately.

Example:

```pdx
ideas = {
	country = {
		TAG_new_spirit = {
			allowed = { always = no }
			allowed_civil_war = { always = yes }
			removal_cost = -1
			picture = generic_production_bonus

			equipment_bonus = {
                infantry_equipment = {
                    build_cost_ic = -0.10
                    instant = yes
                }
            }
		}
	}
}
```

## How To Add Buildings In A Focus

Buildings are state-scoped. Use `add_extra_state_shared_building_slots` before factories when needed, and put construction inside a state scope such as `random_owned_controlled_state`, a specific state id, or a loop.

```pdx
completion_reward = {
	random_owned_controlled_state = {
		limit = {
			free_building_slots = {
				building = industrial_complex
				size > 0
				include_locked = yes
			}
		}
		add_extra_state_shared_building_slots = 1
		add_building_construction = {
			type = industrial_complex
			level = 1
			instant_build = yes
		}
	}
}
```

If the effect is random or conditional, mirror it in `complete_tooltip` or add/update a `custom_effect_tooltip`; otherwise players may see misleading rewards.

Common building ids: `industrial_complex`, `arms_factory`, `dockyard`, `infrastructure`, `air_base`, `synthetic_refinery`, `fuel_silo`, `radar_station`, `bunker`, `coastal_bunker`, `naval_base`.

## How To Choose Vanilla Icons

### Focus Icon

1. Search existing focus icons:

```powershell
rg --no-ignore -n "name = `"GFX_goal_|GFX_goal_" vanilla BigLeninHistMod -g "*.gfx"
rg -n "icon = GFX_goal_" BigLeninHistMod/common/national_focus vanilla/common/national_focus
```

2. Reuse the sprite id directly:

```pdx
icon = GFX_goal_generic_construct_military
```

### National Spirit Icon

1. Search idea pictures and sprites:

```powershell
rg --no-ignore -n "picture =|GFX_idea_" BigLeninHistMod/common/ideas vanilla/common/ideas BigLeninHistMod/interface vanilla/interface -g "*.txt" -g "*.gfx"
```

2. In ideas, use the picture token without `GFX_idea_` when nearby files do that:

```pdx
picture = generic_production_bonus
```

Prefer vanilla icons unless the task explicitly asks for custom art.

## How To Add A New Focus

1. Pick a unique id with the country prefix: `TAG_new_focus`.
2. Insert the focus near related focuses in the country focus file.
3. Set `icon`, `prerequisite`, `x`, `y`, `relative_position_id`, `cost`, and `completion_reward`.
4. Add `mutually_exclusive`, `available`, `bypass`, `cancel_if_invalid`, `continue_if_invalid`, and `available_if_capitulated` only when needed; copy local tree patterns.
5. Add localization for `TAG_new_focus` and `TAG_new_focus_desc`.
6. If adding a spirit, add the idea plus idea localization.
7. If adding a custom tooltip, add/update the `_tt` localization in both languages.
8. Search for broken references and validate.

## Custom Tooltip Discipline

Treat custom tooltips as part of the implementation, not flavor text.

When changing any focus reward:

1. Search the focus block for `custom_effect_tooltip`, `custom_trigger_tooltip`, and `complete_tooltip`.
2. Search localization for the focus id and every `_tt` key used in the block.
3. Update numbers, building counts, state names, idea names, duration, and conditions.
4. If an automatic tooltip is clear, do not add a duplicate custom tooltip.
5. If the actual effect is hidden, random, conditional, or uses `hidden_effect`, provide a clear custom tooltip.

## Useful Effect Patterns

Add or remove ideas:

```pdx
add_ideas = TAG_spirit
remove_ideas = TAG_spirit
```

Guard an effect:

```pdx
if = {
	limit = { has_completed_focus = TAG_other_focus }
	add_political_power = 50
}
```

Hidden implementation with visible tooltip:

```pdx
custom_effect_tooltip = TAG_focus_effect_tt
hidden_effect = {
	set_country_flag = TAG_focus_done
}
```

## HOI4 MCP CLI

The `scripts/hoi4-mcp-cli.js` utility provides access to HOI4 modding tools
via the command line. It automatically finds the project root and the mod content subdirectory.

### Basic Usage

```bash
node scripts/hoi4-mcp-cli.js <tool_name> [--key value ...]
node scripts/hoi4-mcp-cli.js --interactive    # interactive mode
node scripts/hoi4-mcp-cli.js --list           # list all tools
node scripts/hoi4-mcp-cli.js --help           # help
```

- String params: `--key "value"`
- Number params: `--key 123`
- Boolean params: `--key true` / `--key false`
- Array params: `--key [1,2,3]`
- Object params: `--key '{"a":1}'`

> **Note:** Each CLI call reloads map data (~10 seconds). For map and GUI tools,
> use `/skill:hoi4-map` and `/skill:hoi4-gui` in pi instead.

---

## Script Tools

Search, parse, validate, and analyze Clausewitz scripts.

### script_search

Search across all mod files (regex supported). Like grep for the entire mod.

```bash
node scripts/hoi4-mcp-cli.js script_search --pattern "has_idea"
node scripts/hoi4-mcp-cli.js script_search --pattern "country_event" --file_pattern "events/"
node scripts/hoi4-mcp-cli.js script_search --pattern "TAG_focus" --case_sensitive true --max_results 20
```

Parameters: `pattern` (required), `file_pattern`, `case_sensitive`, `max_results`.

### script_get_definitions

Find all definitions of a given type across the mod: event, focus, decision, idea,
scripted_effect, scripted_trigger, scripted_gui, technology, on_action, character,
country_flag, global_flag, state_flag, variable, country_history.

```bash
node scripts/hoi4-mcp-cli.js script_get_definitions --type focus
node scripts/hoi4-mcp-cli.js script_get_definitions --type idea --query "SOV_"
node scripts/hoi4-mcp-cli.js script_get_definitions --type event --query "hl2"
```

### script_get_references

Find all references to an identifier across the mod (exact word match).

```bash
node scripts/hoi4-mcp-cli.js script_get_references --name "TAG_my_focus"
node scripts/hoi4-mcp-cli.js script_get_references --name "SOV_new_spirit"
```

### script_parse_file

Parse a .txt file into a structured AST. Useful for understanding file structure.

```bash
node scripts/hoi4-mcp-cli.js script_parse_file --file "events/hl2_events.txt"
node scripts/hoi4-mcp-cli.js script_parse_file --file "common/national_focus/SOV.txt" --max_depth 3
```

### script_validate_file

Validate a file: bracket matching, undefined references, missing localization,
empty blocks, deprecated syntax.

```bash
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/achievements.txt"
node scripts/hoi4-mcp-cli.js script_validate_file --file "events/hl2_events.txt"
```

### script_get_scope_context

Determine the scope context at a specific line in a file. Shows current scope
(country/state/character), scope stack, and nesting depth.

```bash
node scripts/hoi4-mcp-cli.js script_get_scope_context --file "common/national_focus/SOV.txt" --line 50
```

### script_lookup_effect

Look up a HOI4 effect/trigger/modifier. Database of 215 effects, triggers,
modifiers, and scopes.

```bash
node scripts/hoi4-mcp-cli.js script_lookup_effect --name "add_political_power"
node scripts/hoi4-mcp-cli.js script_lookup_effect --search "stability"
node scripts/hoi4-mcp-cli.js script_lookup_effect --search "war" --type_filter trigger
node scripts/hoi4-mcp-cli.js script_lookup_effect --name "add_ideas" --scope_filter country
```

Parameters: `name`, `search`, `type_filter` (effect/trigger/modifier/scope/define/structure),
`category_filter` (resources/diplomacy/military/...), `scope_filter` (country/state/character/...).

---

## Mod Structure & File Tools

### mod_get_structure

Get the full mod directory structure: file counts per category, lines of code, file sizes.

```bash
node scripts/hoi4-mcp-cli.js mod_get_structure
```

### mod_get_file

Read any file from the mod with line numbers. Supports line ranges.

```bash
node scripts/hoi4-mcp-cli.js mod_get_file --file "common/national_focus/SOV.txt"
node scripts/hoi4-mcp-cli.js mod_get_file --file "events/hl2_events.txt" --start_line 10 --end_line 50
```

---

## Localization Tools

### loc_search

Search localization keys and values. Matches both key names and translated text.

```bash
node scripts/hoi4-mcp-cli.js loc_search --query "SOV_"
node scripts/hoi4-mcp-cli.js loc_search --query "industry" --language english
node scripts/hoi4-mcp-cli.js loc_search --query "завод" --language russian
```

### loc_get

Get a localization key's value in all available languages.

```bash
node scripts/hoi4-mcp-cli.js loc_get --key "STATE_1"
node scripts/hoi4-mcp-cli.js loc_get --key "SOV_fascism"
```

### loc_validate

Validate localization: keys used in scripts but not defined; keys defined but not
referenced; keys in one language but missing in another.

```bash
node scripts/hoi4-mcp-cli.js loc_validate
node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true
node scripts/hoi4-mcp-cli.js loc_validate --check_unused true   # slow
```

### loc_set

Write or update a single localization key. Creates/updates .yml file with BOM.

```bash
node scripts/hoi4-mcp-cli.js loc_set --key "my_event.1.t" --value "Event Title"
node scripts/hoi4-mcp-cli.js loc_set --key "my_event.1.desc" --value "Event description" --language russian
node scripts/hoi4-mcp-cli.js loc_set --key "my_event.1.t" --value "Event Title" --file "localisation/english/my_events_l_english.yml"
```

### loc_bulk_set

Write multiple localization key-value pairs at once. Efficient for generating loc
for events, focuses, decisions.

```bash
node scripts/hoi4-mcp-cli.js loc_bulk_set --entries '[{"key":"my_focus","value":"My Focus"},{"key":"my_focus_desc","value":"Description"}]'
node scripts/hoi4-mcp-cli.js loc_bulk_set --entries '[{"key":"my_focus","value":"Мой фокус"},{"key":"my_focus_desc","value":"Описание"}]' --language russian
```

### Localization Rules (reminder)

- All .yml files must be UTF-8 with BOM.
- Every new/changed key needs English and Russian localization.
- Focus names: `<focus_id>`, descriptions: `<focus_id>_desc`.
- Idea names: `<idea_id>`, descriptions: `<idea_id>_desc`.
- Custom tooltips usually end with `_tt`. If a focus uses `custom_effect_tooltip`,
  update its loc when the effect changes.

---

## Validation

use cli tools to validate files:

```bash
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/achievements.txt" 
node scripts/hoi4-mcp-cli.js script_validate_file --file "events/hl2_events.txt"

node scripts/hoi4-mcp-cli.js loc_validate
node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true
node scripts/hoi4-mcp-cli.js loc_validate --check_unused true   # slow
```

If user asks for it, run the Windows smoke test from repo root:

```powershell
python scripts\hoi4-smoke-windows.py
```

It temporarily enables only this mod, backs up/restores launcher files, unlocks DLC through CreamAPI by default, and fails on fresh `logs/error.log` entries except hardcoded ignored files. Useful env vars: `HOI4_DIR`, `PDX_USER_DIR`, `SMOKE_TIMEOUT`, `SMOKE_TAG`, `SMOKE_INCLUDE_PATTERN`, `SMOKE_MAX_ERROR_ENTRIES`.


## Worktrees

```powershell
# Create:  .\scripts\git-newworktree.ps1 -Branch <name>
# List:   git worktree list
# Open:   code "../BigLeninHistMod.worktrees/<name>"
```

Copies extra files via symlink by default: `node_modules/`, `scripts/mcp/node_modules/`, `.pi/rag-cache.json`, `.env*`.

Flags: `-UseSymlinks:$false` (copy instead), `-CopyPiCache:$false` / `-CopyNodeModules:$false` (skip items).

Edit extra paths in `$ExtraItems` array in `scripts/git-newworktree.ps1`.


## External References Used For This Guide

- HOI4 Paradox Wiki pages: National focus modding, Idea modding, Effects, national focus icon category.
- HOI4 Modding Wiki pages: `Common/national_focus`, `Effects`.
- Local BLHM and vanilla files remain authoritative when examples conflict.
