# Scripted Effects & Triggers

## Scripted Effects

Reusable effect blocks in `common/scripted_effects/`:

```pdx
# common/scripted_effects/TAG_effects.txt

TAG_industrial_boost = {
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

TAG_war_prepare = {
    add_war_support = 0.05
    add_political_power = 50
    TAG_industrial_boost = yes          # Call another scripted effect
}
```

**Usage:**
```pdx
completion_reward = {
    TAG_war_prepare = yes
}
```

## Scripted Triggers

Reusable trigger blocks in `common/scripted_triggers/`:

```pdx
# common/scripted_triggers/TAG_triggers.txt

TAG_is_ready_for_war = {
    has_war_support > 0.5
    has_political_power > 100
    num_of_civilian_factories > 20
}

TAG_has_industry = {
    num_of_civilian_factories > 10
    num_of_military_factories > 5
}
```

**Usage:**
```pdx
# In focus:
available = {
    TAG_is_ready_for_war = yes
}

# In event trigger:
trigger = {
    original_tag = TAG
    TAG_has_industry = yes
}
```

## Scoped Blocks

Effects and triggers can be scoped to different objects:

```pdx
# Country scope:
TAG = {
    add_political_power = 100
}

# State scope:
state = 123 = {
    add_extra_state_shared_building_slots = 1
}

# Every country:
every_country = {
    limit = { has_war = yes }
    add_war_support = 0.05
}

# Random country:
random_country = {
    limit = { has_war = no }
    add_stability = 0.1
}

# Controlled states:
every_controlled_state = {
    add_extra_state_shared_building_slots = 1
}

# Every unit:
every_army_unit = {
    limit = { has_division_template = "Infantry Division" }
    add_experience = 10
}
```

## Variable System

HOI4 has a dynamic variable system:

```pdx
# Set a variable:
set_variable = { var = my_var value = 10 }

# Math operations:
add_to_variable = { var = my_var value = 5 }
subtract_from_variable = { var = my_var value = 3 }
multiply_variable = { var = my_var value = 2 }

# Compare:
if = {
    limit = { check_variable = { my_var > 5 } }
    # ...
}

# Clear:
clear_variable = my_var
```

## Flags

```pdx
# Set:
set_country_flag = TAG_my_flag
set_country_flag = { flag = TAG_timed_flag value = 1 days = 30 }  # Timed

# Check:
has_country_flag = TAG_my_flag
NOT = { has_country_flag = TAG_my_flag }

# Clear:
clr_country_flag = TAG_my_flag

# Global flags:
set_global_flag = global_flag_name
has_global_flag = global_flag_name
clr_global_flag = global_flag_name

# State flags:
set_state_flag = { flag = state_flag value = 1 }
has_state_flag = state_flag
```

## Common Effects Reference

```pdx
# Political:
add_political_power = 100
add_stability = 0.05
add_war_support = 0.05
add_popularity = { ideology = fascism popularity = 0.1 }

# Ideas:
add_ideas = TAG_spirit
remove_ideas = TAG_spirit
swap_ideas = { remove_idea = old add_idea = new }
add_timed_idea = { idea = TAG_timed days = 365 }

# Territory:
transfer_state = 123
add_state_core = 123
add_state_claim = 123
remove_state_core = 123
remove_state_claim = 123

# Diplomacy:
add_to_faction = TAG
remove_from_faction = TAG
puppet = TAG
release_puppet = TAG
set_faction_leader = TAG
add_war_goal = { ... }
white_peace = TAG
add_opinion_modifier = { target = TAG modifier = TAG_modifier }

# Production:
add_equipment_to_stockpile = { type = infantry_equipment_1 amount = 500 }
add_offsite_factory = { type = industrial_factory level = 3 }
set_production_efficiency = { ... }

# Research:
add_research_slot = 1
add_tech_bonus = { ... }
set_country_flag = TAG_tech_bonus_flag
```
