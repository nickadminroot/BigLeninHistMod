# Ideas & National Spirits

## Structure

Ideas live in `common/ideas/`. Each file can contain multiple idea categories:

```pdx
ideas = {
    country = {         # Visible national spirits
        TAG_spirit = {
            picture = generic_production_bonus  # Icon (without GFX_idea_ prefix)
            allowed = { always = no }            # Not buyable from menu
            allowed_civil_war = { always = yes } # Survives civil war
            removal_cost = -1                    # -1 = cannot be manually removed
            modifier = {
                industrial_capacity_factory = 0.05
                research_speed_factor = 0.05
            }
        }
    }

    hidden_ideas = {    # Not visible, effects only
        TAG_hidden = {
            modifier = { ... }
        }
    }

    character = {       # Character-specific ideas
        TAG_trait = {
            character = TAG_character_id
            ...
        }
    }
}
```

## modifier {} vs equipment_bonus {}

| Key | Scope | Use |
|-----|-------|-----|
| `modifier = {}` | Country/State/Unit | Country stats, research speed, factory output, etc. |
| `equipment_bonus = {}` | Equipment | Build cost, reliability, armor, speed, attack, etc. |

**modifier keys:**
- `industrial_capacity_factory` — Factory output
- `production_speed_industrial_complex_factor` — Construction speed
- `research_speed_factor` — Research speed
- `army_org_factor` — Division organization
- `army_attack_factor` — Land attack bonus
- `navy_attack_factor` — Naval attack bonus
- `air_air_superiority_efficiency` — Air superiority
- `consumer_goods_factor` — Consumer goods
- `political_power_gain` — Political power gain
- `stability_weekly` — Weekly stability
- `war_support_weekly` — Weekly war support
- `manpower_factor` — Manpower multiplier
- `conscription` — Conscription factor
- `justify_war_goal_time` — War goal justification time
- `generate_wargoal_tension` — Wargoal tension

**equipment_bonus keys:**
```pdx
equipment_bonus = {
    infantry_equipment = {
        build_cost_ic = -0.1       # 10% cheaper
        reliability = 0.1           # +10% reliability
        soft_attack = 0.1           # +10% soft attack
        instant = yes               # Apply immediately to production
    }
    armor = {                       # Archetype targeting
        armor_value = 0.1
        reliability = 0.05
    }
    mio_cat_eq_all_tanks = {        # MIO equipment group
        build_cost_ic = -0.05
        instant = yes
    }
}
```

## Spirit Templates

### Simple Spirit
```pdx
ideas = {
    country = {
        TAG_industrial_spirit = {
            allowed = { always = no }
            allowed_civil_war = { always = yes }
            removal_cost = -1
            picture = generic_production_bonus
            modifier = {
                industrial_capacity_factory = 0.05
                production_speed_industrial_complex_factor = 0.1
            }
        }
    }
}
```

### Spirit with Equipment Bonus
```pdx
ideas = {
    country = {
        TAG_equipment_spirit = {
            allowed = { always = no }
            allowed_civil_war = { always = yes }
            removal_cost = -1
            picture = generic_infantry_bonus
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

### Spirit with Modifier + Equipment Bonus
```pdx
ideas = {
    country = {
        TAG_mixed_spirit = {
            allowed = { always = no }
            allowed_civil_war = { always = yes }
            removal_cost = -1
            picture = generic_manpower_bonus
            modifier = {
                army_org_factor = 0.1
                conscription = 0.01
            }
            equipment_bonus = {
                infantry_equipment = {
                    build_cost_ic = -0.05
                    instant = yes
                }
            }
        }
    }
}
```

### Upgrading Spirits (Swap)
```pdx
# Don't stack duplicate modifiers — swap instead:
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

Use the same localized name for old/new variants when the UI should show "Modify <spirit>" behavior. Update any custom tooltip that describes the upgrade.

### Timed Ideas
```pdx
add_timed_idea = {
    idea = TAG_timed_modifier
    days = 180              # Duration in days
    # OR months = 6
}
```

### Removing Ideas
```pdx
remove_ideas = TAG_spirit
```

### Idea Localization
```yaml
# localisation/english/ideas_l_english.yml
l_english:
 TAG_industrial_spirit: "Industrial Development"
 TAG_industrial_spirit_desc: "A national spirit representing focused industrial growth. Increases factory output by 5%."
```

## Idea Validation

```bash
# Find all ideas:
node scripts/hoi4-mcp-cli.js script_get_definitions --type idea

# Search for specific ideas:
node scripts/hoi4-mcp-cli.js script_get_definitions --type idea --query "TAG_"

# Check references:
node scripts/hoi4-mcp-cli.js script_get_references --name "TAG_spirit"
```
