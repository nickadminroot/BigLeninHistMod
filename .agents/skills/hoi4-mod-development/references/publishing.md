# Publishing to Steam Workshop

## Two Methods

### Method 1: Paradox Launcher (Manual)

1. Open Paradox Launcher → Mods → My Mods
2. Select mod → "Upload to Steam Workshop"
3. Fill in title, description, tags, preview image
4. Confirm — launcher handles everything

### Method 2: SteamCMD (Automated)

Upload mods without the launcher using SteamCMD.

**Requirements:**
- SteamCMD installed (download from https://developer.valvesoftware.com/wiki/SteamCMD)
- Steam account with HOI4 in library
- AppID: `394360`

## SteamCMD Setup

### Install SteamCMD

```bash
# Windows - download and extract:
mkdir -p D:/SteamCMD
cd D:/SteamCMD
# Download from https://developer.valvesoftware.com/wiki/SteamCMD
# Extract steamcmd.zip

# Or use the upload script which auto-detects:
python scripts/hoi4_workshop_upload.py --dry-run
```

### First Run

SteamCMD self-updates on first run:
```bash
D:/SteamCMD/steamcmd.exe +quit
```

### Authentication

Three login modes:

1. **Password login** (recommended for automation):
   ```bash
   python scripts/hoi4_workshop_upload.py --login USER --password PASS
   ```
   Or use `.env` file (see `.env.example`).

2. **Session login** (after first manual login):
   ```bash
   python scripts/hoi4_workshop_upload.py --login USER
   ```
   Works if SteamCMD session is saved.

3. **Interactive login** (manual):
   ```bash
   python scripts/hoi4_workshop_upload.py
   ```
   Prompts for credentials.

### Steam Guard

**Mobile authenticator** — requires phone confirmation on EVERY login:
- Run script → Steam prompts "Please confirm in Steam Mobile app" → confirm on phone → upload proceeds
- Session files in `SteamCMD/config/` do NOT bypass mobile authenticator
- This is Steam's security design, not a bug

**Email Steam Guard** — session persists after first confirmation:
- First login: enter code from email
- Subsequent logins: no code needed (sentry file saved)

**For full automation** — use a Steam account WITHOUT mobile authenticator.
The mod-upload account should own the Workshop items you're updating.

**Session files:** SteamCMD saves auth in `D:/SteamCMD/config/config.vdf`.
Preserve this directory for email-based Steam Guard.
For mobile authenticator, confirmation is always required.

**.env file locations:** The upload script checks multiple locations for .env:
1. Current working directory (`./.env`)
2. Repository root (`../.env` relative to script)
3. Script directory

Place `.env` in your repo root for easiest access.

## VDF File Format

SteamCMD needs a `.vdf` file to know what to upload:

```vdf
"workshopitem"
{
    "appid"             "394360"
    "publishedfileid"   "3683025629"
    "contentfolder"     "G:\\path\\to\\mod\\MyMod"
    "previewfile"       "G:\\path\\to\\mod\\MyMod\\thumbnail.png"
    "visibility"        "0"
    "title"             "My Mod Name"
    "description"       "Mod description for Workshop page."
    "changenote"        "Updated via SteamCMD"
}
```

**Key fields:**
- `appid` — `394360` for HOI4 (always this value)
- `publishedfileid` — Workshop item ID (`0` for first upload, existing ID for updates)
- `contentfolder` — **Absolute path** to mod folder containing `descriptor.mod`
- `previewfile` — **Absolute path** to preview image
- `visibility` — `0`=Public, `1`=Friends-only, `2`=Private

**Important:** `contentfolder` must point to the INNER mod folder, not the repo root.

## Upload Script

```bash
# Auto-generate VDF and upload:
python scripts/hoi4_workshop_upload.py

# Options:
--login USER        Steam username
--password PASS     Steam password (prefer .env instead)
--changenote TEXT   Change note for this upload
--preview PATH      Custom preview image
--visibility N      0=Public, 1=Friends, 2=Private
--dry-run           Show VDF without uploading
--vdf-only          Generate VDF file only
```

**Example — first upload with password:**
```bash
python scripts/hoi4_workshop_upload.py --login myuser --password mypass --changenote "Initial upload"
```

**Example — update with session:**
```bash
python scripts/hoi4_workshop_upload.py --login myuser --changenote "Fixed focus tree bug"
```

**Example — with .env file:**
```bash
# Create .env from example:
cp .env.example .env
# Edit .env with your credentials

# Then just run:
python scripts/hoi4_workshop_upload.py
```

## Description and Changelog

Workshop description and changelog are **NOT stored in descriptor.mod** — they're passed as arguments to the upload script. Create separate `.txt` files:

```
MyMod/
├── descriptor.mod
├── description.txt    ← Workshop page description
├── changelog.txt      ← Change note for this upload
└── localisation/
```

**description.txt** — what visitors see on the Workshop page:
```
Russian translation for ModName

Features:
- All focuses translated
- All events translated
...
```

**changelog.txt** — shown in SteamCMD upload history:
```
Update v2.0.0:
- Added translations for new focuses
- Fixed typo in event descriptions
```

**Upload command:**
```bash
python scripts/hoi4_workshop_upload.py \
  --mod-path MyMod \
  --title "Mod Name — Russian Translation" \
  --description "$(cat description.txt)" \
  --changenote "$(cat changelog.txt)"
```

## Updating Existing Mod

1. Set `publishedfileid` in VDF to your Workshop item ID
2. Run the upload script — it overwrites the existing item
3. `descriptor.mod` should have `remote_file_id="YOUR_ID"`

**Finding your Workshop ID:**
- Steam Workshop URL: `https://steamcommunity.com/sharedfiles/filedetails/?id=3683025629`
- Or check `mods/ugc_3683025629.mod` (auto-created by Steam)

## Mod Structure for Upload

```
MyMod/                             ← contentfolder (what gets uploaded)
├── descriptor.mod                 # NO path= line
├── thumbnail.png                  # Preview image
├── common/
├── events/
├── history/
├── localisation/
├── interface/
├── gfx/
├── map/
├── music/
└── sound/
```

**Do NOT upload:**
- `.git/` directory
- `scripts/` directory
- `AGENTS.md`, `docs/`, `.vscode/`
- Any non-game files

## Descriptor Rules

### descriptor.mod (inside mod folder)
```pdx
version="1.0"
tags={ "Balance" "Historical" }
name="MyMod"
supported_version="1.18.*"
picture="thumbnail.png"
remote_file_id="3683025629"        # After first upload
# NO path= line
```

### mods/MyMod.mod (launcher descriptor)
```pdx
version="1.0"
tags={ "Balance" "Historical" }
name="MyMod"
supported_version="1.18.*"
path="G:/path/to/mod/MyMod"        # Local path
remote_file_id="3683025629"
# Same replace_path as descriptor.mod
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Invalid content folder" | `contentfolder` wrong | Use absolute path to mod folder |
| "Missing descriptor.mod" | Wrong folder level | Point to folder WITH descriptor.mod |
| New item created instead of update | `publishedfileid="0"` | Set your actual Workshop ID |
| Mod doesn't work for subscribers | `path=` in uploaded descriptor | Remove `path=` from descriptor.mod |
| "Failed to parse build config" | VDF syntax error | Use single braces `{}`, not `{{}}` |
| Steam Guard timeout | Mobile authenticator needs phone confirmation | Confirm on phone within timeout window |
| "Cached credentials not found" | First login on this SteamCMD install | Use `--login USER --password PASS` first time |

## VDF Generation Pitfalls

When generating VDF programmatically:
- Use `{` and `}`, NOT `{{` and `}}` (VDF is not JSON)
- In Python f-strings, write: `vdf += '{\n'` not `vdf += '{{\n'`
- All paths must be ABSOLUTE, not relative
- Use double backslashes in Windows paths: `C:\\path\\to\\mod`

## Steam Workshop Best Practices

### Preview Image
- 16:9 aspect ratio (1920×1080 recommended)
- Shows mod features clearly
- No Steam watermark

### Description
- List major features
- Compatibility notes (DLC requirements, version)
- Credits and dependencies
- changelog link

### Tags
Choose relevant tags for discoverability:
- Balance, Gameplay, Historical, Map, Graphics, Audio
- National Focuses, Military, Technologies, Events, Utilities

### Versioning
- Use semantic versioning: `version="1.2.3"`
- Update `supported_version` when HOI4 updates
- Add changelog in description or link to external changelog
