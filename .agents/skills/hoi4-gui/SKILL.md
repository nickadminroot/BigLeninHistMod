---
name: hoi4-gui
description: Parse, validate, and generate HOI4 GUI/GFX files. Find sprites, create scripted GUIs, generate .gfx sprite definitions from .dds textures.
---

# HOI4 GUI Tools

Uses the CLI tool `scripts/hoi4-mcp-cli.js` from the project root.

## Setup

```bash
cd /path/to/mod
```

## Parse .gfx Files

Parses a sprite definition file and returns sprite names, textures, animation frames, and properties.

```bash
node scripts/hoi4-mcp-cli.js gui_parse_gfx --file "interface/my_sprites.gfx"
```

## Parse .gui Files

Parses a window layout file and returns the element tree: window types, positions, sizes, sprites, and behaviors.

```bash
node scripts/hoi4-mcp-cli.js gui_parse_gui --file "interface/my_gui.gui"
```

## Validate GUI/GFX

Checks:
- Sprites referenced in .gui exist in .gfx files
- `window_name` in scripted_gui matches `containerWindowType` in .gui
- .dds texture files exist on disk

```bash
node scripts/hoi4-mcp-cli.js gui_validate
node scripts/hoi4-mcp-cli.js gui_validate --gui_file "interface/my_gui.gui"
node scripts/hoi4-mcp-cli.js gui_validate --check_textures false
```

## Find Sprites

Searches all sprite definitions across the mod. Useful for finding available sprites when building GUIs.

```bash
node scripts/hoi4-mcp-cli.js gui_get_sprites
node scripts/hoi4-mcp-cli.js gui_get_sprites --query "icon"
node scripts/hoi4-mcp-cli.js gui_get_sprites --type spriteType
node scripts/hoi4-mcp-cli.js gui_get_sprites --query "goal" --type corneredTileSpriteType
```

## Create Scripted GUI

Generates a scripted GUI definition file (`common/scripted_guis/*.txt`):

```bash
node scripts/hoi4-mcp-cli.js gui_create_scripted_gui \
  --name "my_resistance_panel" \
  --window_name "my_resistance_window"
```

With options:
```bash
node scripts/hoi4-mcp-cli.js gui_create_scripted_gui \
  --name "my_custom_panel" \
  --window_name "my_custom_window" \
  --context_type "selected_state_context" \
  --visible "always = yes" \
  --effects '[{"name":"on_click","script":"add_political_power = 10"}]' \
  --properties '[{"name":"localization_key","script":"get_localization_key"}]'
```

Parameters:
- `name` * — scripted GUI name (required)
- `window_name` * — containerWindowType name in .gui (required)
- `context_type` — `player_context` (default), `selected_state_context`, `diplomacy_context`
- `visible` — visibility trigger (default `always = yes`)
- `effects` — array of `{name, script}` for effect blocks
- `properties` — array of `{name, script}` for dynamic property blocks

## Generate .gfx from .dds Textures

Scans a directory for .dds files and creates matching spriteType definitions.

```bash
node scripts/hoi4-mcp-cli.js gui_generate_gfx --directory "gfx/interface/my_mod"
node scripts/hoi4-mcp-cli.js gui_generate_gfx --directory "gfx/interface/my_mod" --output_file "interface/my_sprites.gfx" --prefix "GFX_MYMOD_"
```

Parameters:
- `directory` * — path to directory with .dds files (relative to mod root)
- `output_file` — output .gfx path (default `interface/generated_sprites.gfx`)
- `prefix` — sprite name prefix (default `GFX_`)

## Interactive Mode

```bash
node scripts/hoi4-mcp-cli.js --interactive
```
