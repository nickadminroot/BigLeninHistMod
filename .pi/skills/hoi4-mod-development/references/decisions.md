# Decisions

## Structure

Decisions live in `common/decisions/`. Each file contains decisions within categories.

```pdx
# common/decisions/TAG_decisions.txt

TAG_decisions = {                    # Category name (visible in UI)
    tag_decision_1 = {               # Decision ID
        icon = GFX_goal_generic_major_war  # Icon sprite

        # Scoping:
        allowed = {                  # Who can see this decision
            tag = TAG
        }

        visible = {                  # When is it visible (UI)
            has_country_flag = TAG_unlocked_decision
        }

        available = {                # When can it be taken (buttons)
            has_political_power > 50
            has_war = yes
        }

        priority = 100               # Higher = shown first

        # Cost and cooldown:
        cost = 50                    # Political power cost
        days_remove = 30             # Days until remove_effect fires
        days_re_enable = 90          # Cooldown before can be taken again

        # Effects:
        complete_effect = {          # Fires immediately on take
            add_political_power = -50
        }

        remove_effect = {            # Fires after days_remove
            add_stability = 0.05
        }

        cancel_effect = {            # Fires if cancelled
            add_political_power = 25 # Refund partial
        }

        # AI behavior:
        ai_will_do = {
            factor = 1
            modifier = { factor = 0 has_political_power < 100 }
        }
    }
}
```

## Decision Categories

Categories group decisions in the UI:

```pdx
# common/decisions/categories/00_decision_categories.txt

TAG_economic_decisions = {
    icon = GFX_decision_category_economic
    priority = 50
    allowed = { tag = TAG }
    visible = { has_country_flag = TAG_econ_unlocked }
}
```

## Missions (Timed Decisions)

Missions have a visible countdown timer:

```pdx
TAG_industrial_mission = {
    icon = GFX_decision_generic_factory
    available = { ... }
    visible = { ... }

    fire_only_once = yes             # Can only be taken once

    days_mission_timeout = 180       # Timer duration

    timeout_effect = {               # What happens when timer expires
        add_stability = 0.1
    }

    cancel_effect = {                # What happens if cancelled early
        add_stability = -0.05
    }

    complete_effect = {              # What happens when taken
        add_political_power = -100
    }

    ai_will_do = { factor = 1 }
}
```

## Targeted Decisions

Decisions that target specific states, countries, or units:

```pdx
TAG_invest_in_state = {
    icon = GFX_decision_generic_construction

    state_target = yes               # Target is a state
    # OR:
    # country_target = yes           # Target is a country

    on_map_mode = map_only           # Show on map
    # OR:
    # on_map_mode = attachment_only
    # on_map_mode = map_and_attachment

    target_array = controlled_states  # Which states to show on

    target_trigger = {               # Which targets are valid
        is_owned_by = TAG
        free_building_slots = {
            building = industrial_complex
            size > 0
        }
    }

    state_target_trigger = { ... }   # For state targets
    country_target_trigger = { ... } # For country targets

    complete_effect = {
        target = {
            add_extra_state_shared_building_slots = 1
            add_building_construction = {
                type = industrial_complex
                level = 1
                instant_build = yes
            }
        }
    }
}
```

## Decision Modifiers

Decisions can provide ongoing modifiers while active:

```pdx
TAG_wartime_production = {
    modifier = {
        industrial_capacity_factory = 0.1
        consumer_goods_factor = -0.05
    }

    # Modifier is active while decision is "in progress" (days_remove ticking)
    target_trigger = { ... }
    days_remove = 365
}
```

## Removing Decisions

```pdx
# Remove a decision via another decision or focus:
complete_effect = {
    remove_decision = TAG_old_decision
}
```

## Decision Validation

```bash
# Validate decision file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/decisions/TAG.txt"

# Find all decisions:
node scripts/hoi4-mcp-cli.js script_get_definitions --type decision
```
