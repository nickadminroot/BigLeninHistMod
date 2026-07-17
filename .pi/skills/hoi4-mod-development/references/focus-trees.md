# Focus Trees

## Structure

Focus trees live in `common/national_focus/`. Each file can contain one `focus_tree = {}` block with multiple focuses.

```pdx
focus_tree = {
    id = countryTAG_focus    # Unique tree ID

    country = {              # Which country gets this tree
        factor = 0           # Default weight (0 = never)
        modifier = {
            add = 20
            tag = TAG         # Country tag gets this tree
        }
    }

    default = no             # Is this the default fallback tree?

    continuous_focus_position = { x = 20 y = 1200 }  # Continuous focus pos

    focus = { ... }          # Individual focuses
}
```

## Focus Shape

```pdx
focus = {
    id = TAG_focus_id                    # UNIQUE id with country prefix
    icon = GFX_goal_generic_construct_civilian  # Sprite ID (no quotes on GFX_*)
    prerequisite = { focus = TAG_parent }       # Parent focuses
    x = 0                                 # X position (grid units)
    y = 1                                 # Y position (grid units)
    relative_position_id = TAG_parent     # Position relative to parent
    cost = 5                              # Duration in WEEKS (5 = 35 days)
    ai_will_do = { factor = 1 }          # AI priority
    search_filters = { FOCUS_FILTER_INDUSTRY }  # UI filter category

    # Optional blocks:
    available = { ... }           # Conditions to start this focus
    bypass = { ... }              # Auto-complete conditions
    cancel = { ... }              # Cancel conditions
    mutually_exclusive = { focus = TAG_other }  # Can't take both

    # Flags:
    cancel_if_invalid = yes       # Cancel if prereqs no longer met
    continue_if_invalid = no      # Continue even if invalid
    available_if_capitulated = no # Available while capitulated?

    completion_reward = {         # Effects when completed
        add_political_power = 50
    }

    # Optional tooltips:
    complete_tooltip = { ... }    # Tooltip for completion reward
    custom_effect_tooltip = TAG_focus_tt   # Custom tooltip key
    custom_trigger_tooltip = TAG_focus_avail_tt  # Custom trigger tooltip
}
```

## Positioning

Positions use a grid system. Common patterns:

```pdx
# Vertical chain:
focus = { id = TAG_1  x = 0  y = 0  ... }
focus = { id = TAG_2  x = 0  y = 1  relative_position_id = TAG_1  prerequisite = { focus = TAG_1 } }
focus = { id = TAG_3  x = 0  y = 2  relative_position_id = TAG_2  prerequisite = { focus = TAG_2 } }

# Horizontal branch:
focus = { id = TAG_2a  x = -2  y = 1  relative_position_id = TAG_1  prerequisite = { focus = TAG_1 } }
focus = { id = TAG_2b  x = 2   y = 1  relative_position_id = TAG_1  prerequisite = { focus = TAG_1 } }
```

## Duration

`cost = N` where N is in weeks (vanilla `FOCUS_POINT_DAYS = 7`):

| Cost | Days | Use Case |
|------|------|----------|
| 0 | 0 | Instant / event-driven |
| 3 | 21 | Minor focuses |
| 5 | 35 | Standard focuses |
| 7 | 49 | Important focuses |
| 10 | 70 | Major strategic focuses |
| 14 | 98 | Very long (rare) |

## Prerequisites

```pdx
# Single prerequisite:
prerequisite = { focus = TAG_parent }

# Multiple prerequisites (ALL required):
prerequisite = { focus = TAG_parent_a focus = TAG_parent_b }

# OR prerequisites (in separate blocks):
prerequisite = { focus = TAG_parent_a }
prerequisite = { focus = TAG_parent_b }
```

## Mutually Exclusive

```pdx
mutually_exclusive = { focus = TAG_other_focus }
```

## Branch Control

```pdx
# Hide entire branch:
allow_branch = { always = no }

# Conditional branch:
allow_branch = {
    has_country_flag = TAG_some_flag
}

# Delete a focus without removing it:
allow_branch = { always = no }  # Add to existing focus block
```

## Search Filters

Available `FOCUS_FILTER_*` values:
- `FOCUS_FILTER_POLITICAL` — Political focuses
- `FOCUS_FILTER_RESEARCH` — Research bonuses
- `FOCUS_FILTER_INDUSTRY` — Industrial/economic
- `FOCUS_FILTER_STABILITY` — Stability
- `FOCUS_FILTER_WAR_SUPPORT` — War support
- `FOCUS_FILTER_MANPOWER` — Manpower
- `FOCUS_FILTER_ANNEXATION` — Territorial
- `FOCUS_FILTER_INTERNAL_AFFAIRS` — Internal politics
- `FOCUS_FILTER_ARMY_XP` — Army XP
- `FOCUS_FILTER_NAVY_XP` — Navy XP
- `FOCUS_FILTER_AIR_XP` — Air XP
- `FOCUS_FILTER_BALANCE_OF_POWER` — BOP
- `FOCUS_FILTER_HISTORICAL` — Historical path
- `FOCUS_FILTER_INTERNATIONAL_TRADE` — Trade

## Completion Reward Patterns

### Add Political Power
```pdx
add_political_power = 100
```

### Add Stability / War Support
```pdx
add_stability = 0.05          # 5% stability
add_war_support = 0.05        # 5% war support
```

### Add Ideas (National Spirits)
```pdx
add_ideas = TAG_new_spirit
```

### Add War Goal
```pdx
add_war_goal = {
    trigger = { ... }          # Optional conditions
   国家 = TAG_target
    type = annex_everything    # or puppet_gain, take_states, etc.
    expiry = "1940.1.1"        # Optional expiry
}
```

### Add Research Bonus
```pdx
add_tech_bonus = {
    name = TAG_bonus_name      # Localized name
    bonus = 1.0                # 1.0 = one level ahead
    uses = 2                   # Number of uses
    category = armor           # or category = infantry, etc.
    technology = tech_id       # Specific tech (alternative to category)
}
```

### Add Equipment
```pdx
give_equipment = {
    equipment = infantry_equipment_1
    amount = 500
    target = TAG recipient
}
```

### Add Divisions
```pdx
division_template = {
    name = "Infantry Division"
    division_names_group = TAG_INF_01
    is_locked = yes
    regiments = {
        infantry = { x = 0 y = 0 }
        infantry = { x = 0 y = 1 }
        infantry = { x = 1 y = 0 }
        infantry = { x = 1 y = 1 }
    }
}
```

### State Effects (Buildings)
```pdx
random_owned_controlled_state = {
    limit = {
        free_building_slots = {
            building = industrial_complex
            size > 0
            include_locked = yes
        }
    }
    add_extra_state_shared_building_slots = 2
    add_building_construction = {
        type = industrial_complex
        level = 2
        instant_build = yes
    }
}
```

### Swap Ideas (Upgrade Spirit)
```pdx
if = {
    limit = { has_idea = TAG_old_spirit }
    swap_ideas = {
        remove_idea = TAG_old_spirit
        add_idea = TAG_new_spirit
    }
}
```

### Hidden Effect + Custom Tooltip
```pdx
custom_effect_tooltip = TAG_focus_effect_tt
hidden_effect = {
    set_country_flag = TAG_focus_done
}
```

### Add Personality Trait / Unit Leader Trait
```pdx
add_trait = {
    character = TAG_leader
    trait = panzer_leader
}
```

### Effect Guard (Conditional)
```pdx
if = {
    limit = { has_completed_focus = TAG_other_focus }
    add_political_power = 50
}
```

### Custom Tooltip as Separator
```pdx
custom_effect_tooltip = generic_skip_one_line_tt
```

## Icon Selection

Search for available icons:
```bash
# In mod files:
rg -n "icon = GFX_goal_" common/national_focus/

# In interface GFX files:
rg --no-ignore -n "name = \"GFX_goal_" interface/*.gfx

# In vanilla (if available):
rg -n "icon = GFX_goal_" vanilla/common/national_focus/
```

Use the sprite ID directly: `icon = GFX_goal_generic_construct_military`

## Focus Validation

```bash
# Validate a focus file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/national_focus/TAG.txt"

# Find all focuses in mod:
node scripts/hoi4-mcp-cli.js script_get_definitions --type focus

# Search for a specific focus:
node scripts/hoi4-mcp-cli.js script_search --pattern "TAG_my_focus"

# Check references to a focus:
node scripts/hoi4-mcp-cli.js script_get_references --name "TAG_my_focus"
```
