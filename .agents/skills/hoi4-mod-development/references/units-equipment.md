# Units & Equipment

## Division Templates

Division templates are defined in history files or via scripted effects:

```pdx
# In history/units/TAG_1936.txt:
division_template = {
    name = "Infantry Division"
    division_names_group = TAG_INF_01
    is_locked = no

    regiments = {
        infantry = { x = 0 y = 0 }
        infantry = { x = 0 y = 1 }
        infantry = { x = 0 y = 2 }
        infantry = { x = 1 y = 0 }
        infantry = { x = 1 y = 1 }
    }

    support = {
        artillery = { x = 0 y = 0 }
        engineer = { x = 0 y = 1 }
    }
}
```

## Spawning Units

```pdx
# Spawn in a state:
create_unit = {
    division = "name = Infantry Division"
    division_template = "Infantry Division"
    owner = TAG
    province = 1234         # Province ID
}

# Spawn with specific strength:
create_unit = {
    division = "name = Elite Division"
    division_template = "Infantry Division"
    owner = TAG
    province = 1234
    start_experience_factor = 0.5
    start_equipment_factor = 1.0
    start_manpower_factor = 1.0
}
```

## Equipment Stats

Key equipment stats:

| Stat | Description |
|------|-------------|
| `build_cost_ic` | Production cost |
| `reliability` | Chance of not losing equipment |
| `soft_attack` | Attack vs soft targets |
| `hard_attack` | Attack vs hard targets |
| `armor_value` | Armor penetration resistance |
| `ap_attack` | Armor piercing |
| `breakthrough` | Attack while advancing |
| `defense` | Defense while defending |
| `maximum_speed` | Movement speed |
| `hardness` | % damage from soft attacks |
| `air_attack` | Anti-air capability |

## Equipment Upgrades

```pdx
infantry_equipment_quality_upgrade = {
    max_level = 5

    cost = 1
    level_stats = {
        soft_attack = 2
        hard_attack = 1
        defense = 2
        reliability = 0.02
    }
}
```

## Equipment Resources

```pdx
resources = {
    steel = 2
    aluminum = 1
    chromium = 0
    tungsten = 0
    rubber = 0
    oil = 0
}
```

## Unit Names

Division names follow patterns:

```pdx
# common/units/names_divisions/TAG_division_names.txt
TAG_INF_01 = {
    "1st Infantry Division"
    "2nd Infantry Division"
    # ... numbered list
}

TAG_ARM_01 = {
    "1st Armored Division"
    "2nd Armored Division"
}
```

## Validation

```bash
# Search equipment definitions:
node scripts/hoi4-mcp-cli.js script_search --pattern "infantry_equipment"

# Validate unit file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/units/equipment/infantry.txt"
```
