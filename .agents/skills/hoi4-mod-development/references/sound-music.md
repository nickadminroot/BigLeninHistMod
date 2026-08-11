# Sound & Music

## Sound Effects

Sound files go in `sound/` directory:

```
sound/
├── effects/           # Short sound effects
├── music/             # Background music
└── voices/            # Voice-over files
```

### Sound Definition

Sound effects are defined in interface or sound files:

```pdx
# In interface files:
soundeffectType = {
    name = "TAG_my_sound"
    file = "sound/effects/my_sound.ogg"
}
```

## Music

Music files go in `music/`:

```
music/
├── TAG_my_song.ogg
├── TAG_battle_theme.ogg
└── TAG_peace_theme.ogg
```

### Music Definition

```pdx
# music/my_music.txt

song = {
    name = "TAG_my_song"
    file = "TAG_my_song.ogg"

    # Conditions when to play:
    trigger = {
        has_war = yes
        tag = TAG
    }

    # Priority:
    chance = {
        factor = 10
    }
}

song = {
    name = "TAG_peace_song"
    file = "TAG_peace_theme.ogg"

    trigger = {
        has_war = no
    }

    chance = {
        factor = 5
    }
}
```

## Sound Formats

| Format | Use |
|--------|-----|
| `.ogg` | Preferred for music and SFX |
| `.wav` | Supported but large files |
| `.mp3` | Supported |

## Music Tags

Music can be tagged with `music_tag` for conditional playback:

```pdx
song = {
    name = "TAG_war_music"
    file = "TAG_war.ogg"
    music_tag = war_music
}
```

## Validation

```bash
# Check for music references:
node scripts/hoi4-mcp-cli.js script_search --pattern "song" --file_pattern "music/"
```
