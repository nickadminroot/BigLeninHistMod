# AI Strategy & Plans

## AI Strategy

AI strategy files control how AI countries behave:

```pdx
# common/ai_strategy/TAG_ai_strategy.txt

TAG_industry_strategy = {
    strategy = TAG_industrial_focus

    # When to activate:
    trigger = {
        original_tag = TAG
        has_war = no
    }

    # AI weights:
    ai_strategy = {
        type = building_target
        id = industrial_complex
        value = 100        # Build more civilian factories
    }

    ai_strategy = {
        type = building_target
        id = arms_factory
        value = 50         # Build some military factories
    }

    ai_strategy = {
        type = equipment_production_factor
        id = infantry_equipment
        value = 20         # Prioritize infantry equipment
    }
}
```

## AI Strategy Types

| Type | Description |
|------|-------------|
| `building_target` | Building priority |
| `equipment_production_factor` | Equipment production priority |
| `role_ratio` | Unit role ratios |
| `front_ratio` | Front line deployment |
| `area_priority` | Geographic area priority |
| `force_ratio` | Force composition |
| `template_ratio` | Division template priority |
| `influence` | Diplomatic influence |
| `conquer` | Conquest priority |
| `ally` | Alliance priority |
| `prepare_for_war` | War preparation |
| `avoid_starting_wars` | War avoidance |

## AI Strategy Plans

More complex AI behavior in `common/ai_strategy_plans/`:

```pdx
TAG_war_plan = {
    name = TAG_war_plan

    enable = {
        has_war = yes
        has_country_flag = TAG_war_plan_active
    }

    ai_strategy = {
        type = front_unit_request
        area = europe
        value = 200
    }

    ai_strategy = {
        type = invasion_unit_request
        country = TAG_target
        value = 100
    }
}
```

## AI Navy Strategy

```pdx
# common/ai_navy/TAG_navy.txt

TAG_naval_strategy = {
    name = TAG_navy_strategy

    enable = {
        original_tag = TAG
        has_war = yes
    }

    # Strike force vs convoy raiding:
    unit_ratio = {
        type = capital_ship
        value = 0.3
    }

    unit_ratio = {
        type = screen_ship
        value = 0.7
    }
}
```

## Validation

```bash
node scripts/hoi4-mcp-cli.js script_search --pattern "ai_strategy"
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/ai_strategy/TAG.txt"
```
