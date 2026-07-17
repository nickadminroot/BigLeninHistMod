# Events

## Structure

Events live in `events/` directory. Each file contains one or more event blocks:

```pdx
add_namespace = my_events          # Namespace for all events in this file

country_event = {
    id = my_events.1               # namespace.number
    title = my_events.1.t          # Localization key
    desc = my_events.1.desc        # Localization key
    picture = GFX_report_event_generic_handshake  # Event image

    # Trigger (when can this event fire):
    trigger = {
        tag = TAG
        has_war = yes
    }

    # Mean time to happen (MTTH):
    mean_time_to_happen = {
        months = 6                  # Average time in months
        modifier = {
            factor = 0.5           # Halve the time
            has_stability > 0.5
        }
        modifier = {
            factor = 2.0           # Double the time
            has_war = no
        }
    }

    # Effects when event fires:
    option = {
        name = my_events.1.a       # Localized option text
        ai_chance = { factor = 70 } # AI weight for this option
        add_political_power = 50
    }
    option = {
        name = my_events.1.b
        ai_chance = { factor = 30 }
        add_stability = 0.05
    }
}
```

## Event Types

| Type | Scope | Use |
|------|-------|-----|
| `country_event` | country | Most common — events affecting a country |
| `state_event` | state | Events affecting a specific state |
| `unit_event` | unit | Events for specific military units |
| `operative_leader_event` | character | Espionage/operative events |
| `character_event` | character | Character-specific events |

## Mean Time to Happen (MTTH)

```pdx
mean_time_to_happen = {
    months = 12                      # Base time (months)
    modifier = { factor = 0.5 ... } # Multiply time by factor
    modifier = { factor = 2.0 ... }
    days = 30                        # Alternative: days
}
```

**Common modifiers:**
```pdx
modifier = { factor = 0.5 has_war = yes }          # Faster if at war
modifier = { factor = 2.0 has_stability > 0.6 }    # Slower if stable
modifier = { factor = 0.1 date > 1939.1.1 }        # Much faster after date
modifier = { factor = 100 has_country_flag = X }   # Rare if flag set
```

## Event Options

```pdx
option = {
    name = my_events.1.a           # Required: loc key for option text
    name = { trigger = { ... } my_events.1.a_special }  # Conditional name

    ai_chance = {                  # AI selection weight
        factor = 50
        modifier = { factor = 2 has_war = yes }
    }

    # Effects (same as focus completion_reward):
    add_political_power = 100
    add_stability = 0.05
    add_ideas = war_economy
    remove_ideas = civilian_economy
    country_event = { id = my_events.2 days = 30 }  # Chain event
}

# Fire event option (no UI, instant):
fire_only = yes
```

## Event Chains

Chain events by firing the next event in an option:

```pdx
option = {
    name = my_events.1.a
    country_event = { id = my_events.2 days = 14 }
}
```

## Letter Events (No UI)

For background events that don't show a popup:

```pdx
country_event = {
    id = my_events.99
    hidden = yes                    # No popup shown
    fire_only = yes                 # Can't be clicked

    trigger = { ... }

    mean_time_to_happen = { months = 1 }

    option = {
        name = my_events.99.a
        # Effects only — no player interaction
        add_political_power = 10
    }
}
```

## One-Shot Events

Events that should fire only once:

```pdx
mean_time_to_happen = {
    months = 6
}

trigger = {
    NOT = { has_country_flag = my_events.1_fired }
}

option = {
    name = my_events.1.a
    set_country_flag = my_events.1_fired
    # ... effects
}
```

## Event Localization

Event loc keys follow the pattern:
- `my_events.1.t` — event title
- `my_events.1.desc` — event description
- `my_events.1.a` — option A text
- `my_events.1.b` — option B text

```yaml
# localisation/english/my_events_l_english.yml
l_english:
 my_events.1.t: "Important Event"
 my_events.1.desc: "Something happened that requires our attention."
 my_events.1.a: "We shall respond."
 my_events.1.b: "Ignore it."
```

## On-Action Events

Events fire via on_actions hooks (see on-actions.md reference):

```pdx
# In common/on_actions/00_on_actions.txt:
on_startup = {
    effects = {
        country_event = { id = my_events.100 }
    }
}

on_monthly = {
    effects = {
        every_country = {
            limit = { tag = TAG }
            random_list = {
                10 = { country_event = { id = my_events.200 } }
                90 = { }
            }
        }
    }
}
```

## Event Validation

```bash
# Validate event file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "events/my_events.txt"

# Find all events:
node scripts/hoi4-mcp-cli.js script_get_definitions --type event

# Search for event references:
node scripts/hoi4-mcp-cli.js script_search --pattern "country_event.*my_events"
```
