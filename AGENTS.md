# AGENTS.md - BigLeninHistMod

## Mission

BigLeninHistMod is a vanilla-like, multiplayer-oriented historical HOI4 mod focused on balance and performance.

Modify shipped game content only under `BigLeninHistMod/` unless the task explicitly concerns scripts, tooling, or agent docs.

## Before Editing

1. Run `git status --short` and inspect relevant diffs. Never revert user changes unless asked.
2. Re-read the exact files you will edit. This mod changes often; stale context causes bad patches.
3. Use `rg` for search. Prefer MCP tools when available:
   - `hoi4-mcp_mod_get_file`, `hoi4-mcp_script_search`, `hoi4-mcp_script_validate_file`
   - `hoi4-mcp_loc_set` / `hoi4-mcp_loc_bulk_set` for localization
   - map tools for state/province edits
4. Use local vanilla references before guessing:
   - `vanilla/documentation/effects_documentation.md`
   - `vanilla/documentation/triggers_documentation.md`
   - `vanilla/documentation/modifiers_documentation.md`
   - `vanilla/documentation/loc_objects_documentation.md`
   - `vanilla/common/`, `vanilla/events/`, `vanilla/interface/`

## Validation

After content changes, run the Windows smoke test from repo root:

```powershell
python scripts\hoi4-smoke-windows.py
```

It temporarily enables only this mod, backs up/restores launcher files, unlocks DLC through CreamAPI by default, and fails on fresh `logs/error.log` entries except hardcoded ignored files. Useful env vars: `HOI4_DIR`, `PDX_USER_DIR`, `SMOKE_TIMEOUT`, `SMOKE_TAG`, `SMOKE_INCLUDE_PATTERN`, `SMOKE_MAX_ERROR_ENTRIES`.

For quick syntax-only checks, also use available MCP validation tools.

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

## External References Used For This Guide

- HOI4 Paradox Wiki pages: National focus modding, Idea modding, Effects, national focus icon category.
- HOI4 Modding Wiki pages: `Common/national_focus`, `Effects`.
- Local BLHM and vanilla files remain authoritative when examples conflict.
