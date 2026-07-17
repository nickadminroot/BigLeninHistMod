# Technologies & Doctrines

## Tech Tree Structure

Technologies live in `common/technologies/`. Each file defines techs in a folder:

```pdx
technologies = {
    # Position variables (used in folder position = {})
    @1918 = 0
    @1936 = 2
    @1938 = 4
    @1939 = 6
    @1940 = 8

    tech_infantry = {
        # Equipment unlock:
        enable_equipments = {
            infantry_equipment_1
        }

        # Subunit unlock:
        enable_subunits = {
            infantry
        }

        # Research path:
        path = {
            leads_to_tech = tech_infantry_2
            research_cost_coeff = 1
        }

        # Research requirements:
        research_cost = 1.0
        start_year = 1936

        # Folder position:
        folder = {
            name = infantry_folder
            position = { x = 0 y = @1936 }
        }

        # Categories (for bonuses):
        categories = {
            infantry_tech
        }

        # AI behavior:
        ai_will_do = {
            base = 2
            modifier = {
                factor = 4
                date > 1937.1.1
            }
        }
    }
}
```

## Tech Categories

Common categories for `add_tech_bonus`:
- `infantry_tech` — Infantry equipment
- `armor` — Tanks
- `motorized` — Motorized/mechanized
- `artillery` — Artillery
- `support_tech` — Support companies
- `industry` — Industrial tech
- `electronics` — Electronics
- `nuclear` — Nuclear
- `rocketry` — Rockets
- `aircraft` — Aircraft
- `naval` — Naval

## Research Bonuses (from Focuses)

```pdx
# Single category bonus:
add_tech_bonus = {
    name = TAG_infantry_bonus
    bonus = 1.0              # 1.0 = one level ahead, 0.5 = half ahead
    uses = 2                 # Number of techs this applies to
    category = infantry_tech
}

# Multiple categories:
add_tech_bonus = {
    name = TAG_combined_bonus
    bonus = 1.0
    uses = 1
    category = armor
    category = motorized
}

# Specific technology:
add_tech_bonus = {
    name = TAG_specific_bonus
    bonus = 1.0
    uses = 1
    technology = tech_infantry_2
}

# All industrial:
add_tech_bonus = {
    name = TAG_industry_bonus
    bonus = 1.0
    uses = 3
    technology = concentrated_industry
    technology = dispersed_industry
    technology = construction
}
```

## Doctrines

Doctrines live in `common/doctrines/` (with `replace_path` in descriptor.mod).

```pdx
land_doctrine = {
    key = "TAG_doctrine_name"
    icon = GFX Doctrine 1

    # Research requirements:
   研究中心 = {
        tag = TAG
    }

    # Effects:
    add = yes
    row = 0
    column = 0

    # Prerequisites:
    any_parent = { doctrine = doctrine_name_1 doctrine_name_2 }

    # Mutually exclusive:
    mutually_exclusive = { doctrine = other_doctrine }

    # Effects when researched:
    research_bonus = {
        armor = 0.1
    }

    ai_will_do = {
        factor = 1
    }
}
```

## Equipment Definitions

Equipment lives in `common/units/equipment/`:

```pdx
equipments = {
    infantry_equipment_1 = {
        year = 1936

        is_archetype = yes
        is_convertable = yes

        picture = infantry_equipment_1
        interface_level = 1

        type = infantry

        upgrades = {
            infantry_equipment_quality_upgrade
            infantry_equipment_mass_upgrade
        }

        group_by = type

        interface_view_entity = {
            type = infantry_unit_frame
            translate = equip_slot_gfx
        }

        interface_category = interface_category_land

        # Stats:
        reliability = 0.9
        maximum_speed = 4
        hardness = 0

        # Attack:
        soft_attack = 18
        hard_attack = 2
        breakthrough = 0
        defense = 18

        # Piercing:
        ap_attack = 0
        armor_value = 0

        # Air:
        air_attack = 0

        # Production:
        build_cost_ic = 0.35

        # Resources:
        resources = {
            steel = 1
        }

        # Lend-Lease:
        lend_lease_cost = 0.5
    }

    infantry_equipment_0 = {
        parent = infantry_equipment_1
        year = 1918

        # Override specific stats:
        soft_attack = 12
        hard_attack = 1
        defense = 12
        build_cost_ic = 0.30
    }
}
```

## Technology Validation

```bash
# Find all technologies:
node scripts/hoi4-mcp-cli.js script_get_definitions --type technology

# Search for specific tech:
node scripts/hoi4-mcp-cli.js script_search --pattern "tech_infantry"

# Validate tech file:
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/technologies/support.txt"
```
