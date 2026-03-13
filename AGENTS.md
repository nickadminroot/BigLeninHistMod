# AGENTS.md - BigLeninHistMod

## Project Overview
This is vanilla-like multiplayer oriented historical modification for Hearts of Iron IV with strong emphasis on balance and optimization.

## Project Structure

- `./vanilla/documentation/` - Documentation about modding for HOI4. **Read this regularly.**
- `./vanilla/` - Vanilla game files the mod is based on.
- `./BigLeninHistMod/` - Mod files. **Agents should modify files only in this folder and its subfolders.**

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
