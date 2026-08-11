# On Actions

## Structure

On actions live in `common/on_actions/`. They define what happens when game events occur:

```pdx
# common/on_actions/00_on_actions.txt

on_startup = {
    effects = {
        # Runs when game starts
        every_country = {
            limit = { is_ai = no }
            country_event = { id = my_events.100 }
        }
    }
}

on_monthly = {
    effects = {
        # Runs every month
        every_country = {
            limit = { has_country_flag = TAG_monthly_check }
            random_list = {
                10 = { country_event = { id = my_events.200 } }
                90 = { }
            }
        }
    }
}

on_weekly = {
    effects = {
        # Runs every week
    }
}

on_daily = {
    effects = {
        # Runs every day (performance impact!)
    }
}
```

## Common On Actions

| Hook | Timing | Use |
|------|--------|-----|
| `on_startup` | Game start | Initialize variables, fire initial events |
| `on_daily` | Every day | Fast events, timers (use sparingly) |
| `on_weekly` | Every week | Regular checks |
| `on_monthly` | Every month | Economy, politics, AI decisions |
| `on_yearly` | Every year | Long-term effects |
| `on_war` | War declared | War start effects |
| `on_peace` | Peace signed | Post-war effects |
| `on_capitulation` | Country capitulates | Capitulation effects |
| `on_government_change` | Gov type changes | Political changes |
| `on_civil_war` | Civil war starts | CW setup |
| `on_election` | Election occurs | Election effects |
| `on_focus_completed` | Any focus completed | Focus chain effects |
| `on_state_control_change` | State owner changes | Territory effects |
| `on_unit_leader_promoted` | Leader promoted | Promotion effects |
| `on_military_industrial_org_design_created` | MIO design created | MIO effects |

## On Action Effects

```pdx
on_war = {
    effects = {
        # Triggered for both sides
        ROOT = {
            add_war_support = 0.1
        }
        FROM = {
            add_war_support = 0.1
        }
    }
}
```

**Scope variables in on actions:**
- `ROOT` — The country the on action fires for
- `FROM` — The other party (if applicable)
- `PREV` — Previous scope

## Example: Monthly AI Check

```pdx
on_monthly = {
    effects = {
        every_country = {
            limit = {
                is_ai = yes
                has_war = no
                has_political_power > 200
            }
            random_list = {
                30 = {
                    add_stability = 0.01
                    add_political_power = -50
                }
                70 = { }
            }
        }
    }
}
```

## Validation

```bash
# Find all on_actions:
node scripts/hoi4-mcp-cli.js script_get_definitions --type on_action

# Search for specific hook:
node scripts/hoi4-mcp-cli.js script_search --pattern "on_startup"

# Validate file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/on_actions/00_on_actions.txt"
```
