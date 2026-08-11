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

## Debug scripted GUI layout

Use this sequence when a scripted GUI looks clipped, misplaced, or incomplete:

1. Separate visible geometry from dynamic-list population. Search the array's `clear_array`, `add_to_array`, and filter/limit logic, then prove the expected entry count independently of layout.
2. Resolve every `parent_window_name` against local vanilla `.gui` files. Inspect the parent size, `clipping`, `orientation`, and `origo`; nested `100%%` dimensions are parent-relative, and a small or clipping parent can cap a larger child.
3. For a player-context singleton panel, bind to an appropriate non-clipping root when the context permits. Preserve the panel's visibility and context semantics while changing the anchor.
4. For bottom panels, follow vanilla anchor conventions such as `center_down` with a suitable `origo`. Calculate card size, viewport height, number of fully visible cards, and scrollbar gap arithmetically.
5. Build a red-capable static geometry/data check before editing: assert the intended sizes, anchor, binding, and entry-count condition. Then run GUI parsing and script validation.
6. Require a live screenshot check at the target resolution and UI scale. Infer anchor changes from the measured old position before changing `x`/`y`; parser output alone cannot establish visual correctness.

Keep edits minimal and preserve each existing file's line endings. Completion requires all six checks, with the live screenshot confirming placement, clipping, text fit, and the expected number of entries.

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
