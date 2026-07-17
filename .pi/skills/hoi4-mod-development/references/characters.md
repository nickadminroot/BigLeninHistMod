# Characters

## Structure

Characters live in `common/characters/`:

```pdx
# common/characters/TAG.txt

characters = {
    TAG_character_name = {
        name = TAG_character_name         # Loc key
        portrait = GFX_portrait_TAG_character  # Portrait sprite

        # Country assignment:
        country = {
            origin = TAG                  # Home country
            # OR:
            # host = TAG                  # Current host (for exiles)
        }

        # Roles (add one or more):
        army_leader = {                   # Army leader (general/marshal)
            traits = { brilliant_strategist winter_specialist }
            skill = 4                     # Attack skill
            skill = 3                     # Defense skill
            skill = 3                     # Planning skill
            skill = 2                     # Logistics skill
            attack_skill = 4
            defense_skill = 3
            planning_skill = 3
            logistics_skill = 2
            legacy_id = TAG_leader_001
        }

        navy_leader = {                   # Navy leader
            traits = { superior_tactician }
            skill = 3
            attack_skill = 3
            defense_skill = 2
            maneuvering_skill = 3
            coordination_skill = 2
            legacy_id = TAG_naval_001
        }

        advisor = {                       # Political advisor
            slot = political_advisor       # Slot type
            ledger = army                  # or navy, air, industry, etc.
            cost = 150                     # PP cost to hire
            traits = { silent_workhorse }
            ai_will_do = { factor = 1 }
        }

        theorist = {                      # Military theorist
            cost = 100
            ledger = army
            traits = { superior_firepower_theory }
        }

        country_leader = {                # Country leader (ruler)
            ideology = fascism            # or communism, democratic, neutrality
            desc = TAG_character_leader_desc
            expire = "1946.1.1"           # Optional expiry date
            traits = { }
        }

        scientist = {                     # Scientist
            skill = 3
            traits = { experimental_scientist }
        }
    }
}
```

## Character Traits

### Army Leader Traits
- `brilliant_strategist` — Planning bonus
- `inflexible_strategist` — Defense bonus
- `panzer_leader` — Armor bonus
- `infantry_officer` — Infantry bonus
- `cavalry_officer` — Cavalry bonus
- `engineer` — Fort/siege bonus
- `winter_specialist` — Winter combat
- `desert_fox` — Desert combat
- `swamp_fox` — Swamp/marsh combat
- `mountaineer` — Mountain combat
- `paratrooper` — Paratroop bonus
- `trickster` — Deception bonus
- `aggressive_assaulter` — Aggressive attacks
- `defensive_doctrine` — Defensive bonus
- `offensive_doctrine` — Offensive bonus

### Country Leader Traits
- `silent_workhorse` — PP gain
- `ideological_crusader` — War support
- `popular_figurehead` — Stability
- `financial_expert` — Consumer goods
- `industrialist` — Factory output
- `military_industrialist` — Military factory output

## Character References in Other Scripts

```pdx
# In focuses:
completion_reward = {
    TAG_character_name = {
        add_country_leader_trait = charismatic
    }
}

# In events:
option = {
    name = option.a
    TAG_character_name = {
        add_unit_leader_trait = panzer_leader
    }
}

# Character assignment to units:
TAG_character_name = {
    set_unit_leader_flag = TAG_flag
}
```

## Localization

```yaml
l_english:
 TAG_character_name: "Heinz Guderian"
 TAG_character_name_desc: "A brilliant armored warfare theorist."
```
