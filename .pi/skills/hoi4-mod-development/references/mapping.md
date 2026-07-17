# Mapping

## State Files

States live in `history/states/`:

```pdx
# history/states/123-MyState.txt

state = {
    id = 123

    name = STATE_123                    # Loc key
    map_group = REGION_EUROPE           # Map group

    # Owner at start:
    owner = TAG
    // owner = TAG                      # C++ comment style (also valid)

    # Victory points:
    victory_points = {
        { 1234 5 }                     # province_id value
        { 1235 3 }
    }

    # Buildings:
    buildings = {
        infrastructure = 4
        industrial_complex = 3
        arms_factory = 1
        dockyard = 0
        air_base = 2
        naval_base = 0
        bunker = 0
        coastal_bunker = 0
        radar_station = 0
        supply_node = 0
        fuel_silo = 0
    }

    # State category:
    state_category = large_city         # or town, large_town, city, etc.

    # Supply:
    supply_cap = 100                    # Override supply cap

    # Resources:
    resources = {
        steel = 10
        oil = 0
        aluminum = 0
        tungsten = 0
        chromium = 0
        rubber = 0
    }

    # Terrain:
    terrain = forest                    # or plains, hills, mountain, etc.

    # Province list (implicit from province files)
}
```

## State Categories

| Category | Building Slots | Population |
|----------|---------------|------------|
| `naval_base` | 1 | 1M |
| `small_island` | 1 | 1M |
| `tiny_island` | 1 | 1M |
| `enclave` | 2 | 2M |
| `small town` | 2 | 2M |
| `town` | 3 | 3M |
| `large_town` | 4 | 4M |
| `city` | 5 | 5M |
| `large_city` | 6 | 6M |
| `metropolis` | 8 | 8M |
| `megalopolis` | 10 | 10M |

## Strategic Regions

Map in `map/strategicregions/`:

```pdx
strategic_region = {
    id = 100
    name = STRATEGICREGION_100
    provinces = {
        1234 1235 1236 1237
    }
    supply_area = {
        id = 50
        name = SUPPLYAREA_50
    }
}
```

## Supply Areas

```pdx
supply_area = {
    id = 50
    name = SUPPLYAREA_50
    value = 100          # Base supply value
}
```

## Province Data

Province data is in `map/provinces.bmp` (bitmap) — not directly editable as text.

## State History Validation

```bash
# Search states:
node scripts/hoi4-mcp-cli.js script_search --pattern "state = {" --file_pattern "history/states/"

# Validate state file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "history/states/123-MyState.txt"
```
