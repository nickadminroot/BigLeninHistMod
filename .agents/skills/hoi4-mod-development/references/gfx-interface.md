# GFX & Interface

## Sprite Definitions

Graphics sprites live in `interface/` as `.gfx` files:

```pdx
# interface/my_sprites.gfx

spriteTypes = {
    # Focus icon:
    spriteType = {
        name = "GFX_goal_TAG_my_focus"
        texturefile = "gfx/goals/TAG/my_focus.png"
    }

    # Idea picture:
    spriteType = {
        name = "GFX_idea_TAG_my_spirit"
        texturefile = "gfx/ideas/TAG/my_spirit.dds"
    }

    # Event picture:
    spriteType = {
        name = "GFX_report_TAG_my_event"
        texturefile = "gfx/event_pictures/TAG/my_event.dds"
    }

    # Leader portrait:
    spriteType = {
        name = "GFX_portrait_TAG_character"
        texturefile = "gfx/leaders/TAG/portrait_character.dds"
    }
}
```

## Sprite Sheets

For sprite sheets (multiple images in one file):

```pdx
spriteType = {
    name = "GFX_TAG_sprite_sheet"
    texturefile = "gfx/sprites/sheet.png"
    noOfFrames = 4
    alignment = center
}
```

## GUI Definitions

GUI files live in `interface/` as `.gui` files:

```pdx
# interface/my_gui.gui

guiTypes = {
    containerWindowType = {
        name = "TAG_my_window"
        position = { x = 0 y = 0 }
        size = { width = 400 height = 300 }
        orientation = center

        iconType = {
            name = "TAG_my_icon"
            sprite = "GFX_TAG_my_sprite"
            position = { x = 10 y = 10 }
            size = { width = 64 height = 64 }
        }

        textBoxType = {
            name = "TAG_my_text"
            font = "arial_16"
            text = "TAG_my_loc_key"
            position = { x = 80 y = 10 }
            size = { width = 300 height = 30 }
        }
    }
}
```

## Common GUI Elements

| Element | Use |
|---------|-----|
| `containerWindowType` | Container/window |
| `iconType` | Image/sprite display |
| `textBoxType` | Text display |
| `buttonType` | Clickable button |
| `smoothTextBoxType` | Editable text |
| `gridBoxType` | Grid layout |
| `scrollBoxType` | Scrollable container |
| `instantTextBoxType` | Instant text (no animation) |

## 3D Models

3D models for units/ships/tanks:

```pdx
# interface/models.gfx

instantMeshType = {
    name = "TAG_my_tank_mesh"
    file = "gfx/models/TAG/my_tank.mtbn"
}
```

## Image File Formats

| Format | Use |
|--------|-----|
| `.dds` | Textures (preferred for game assets) |
| `.png` | UI elements, focus icons |
| `.tga` | Older format, still supported |
| `.jpg` | Photos (event pictures) |

## Image Sizes

| Asset | Recommended Size |
|-------|-----------------|
| Focus icon | 128×128 px |
| Idea picture | 128×128 px |
| Event picture | 300×200 px |
| Leader portrait | 156×200 px |
| Country flag | 10×10 px (game uses small textures) |
| Division icon | 64×64 px |

## Validation

```bash
# Search sprite definitions:
node scripts/hoi4-mcp-cli.js script_search --pattern "spriteType" --file_pattern "interface/"
```
