# Multiplayer Compatibility

## Common Desync Sources

1. **Random effects without fixed seeds** — `random_list` without `set_temp_variable`
2. **Date-dependent effects** — Different timing across hosts/clients
3. **Player-only effects** — Effects that differ for human vs AI
4. **Missing `is_ai` checks** — AI and human players diverge
5. **Variable math differences** — Floating point precision

## Desync Prevention

### Fixed Random Seeds
```pdx
# BAD — can desync:
random_list = {
    10 = { add_political_power = 50 }
    90 = { }
}

# GOOD — use set_temp_variable first:
set_temp_variable = { temp_random = random }
random_list = {
    10 = { add_political_power = 50 }
    90 = { }
}
```

### AI vs Human Guards
```pdx
# BAD — different for each player:
if = {
    limit = { is_ai = no }
    add_political_power = 100
}

# GOOD — same for everyone:
add_political_power = 100
```

### Consistent Timing
```pdx
# BAD — timing depends on player actions:
on_weekly = {
    every_country = {
        limit = { is_ai = no }
        country_event = { id = my_events.1 }
    }
}

# GOOD — fire for all countries:
on_weekly = {
    every_country = {
        country_event = { id = my_events.1 }
    }
}
```

## Balance for Multiplayer

- Keep focus costs reasonable (3-10 weeks)
- Don't create overpowered spirits for specific countries
- Test with 2+ human players
- Avoid modifiers > 20% on single spirits
- Keep event chains completable in reasonable time

## Testing Multiplayer

1. Host a game with 2+ players
2. Have all players take their countries
3. Play through the mod content
4. Watch for desync notifications
5. Compare game state between players

## Common Multiplayer Mods

- Shared focus trees must work for all participants
- Events should fire for all countries, not just one
- Decisions should be balanced for human vs AI
- Consider "non-historical" mode compatibility
