# Translation Workflow for HOI4 Mods

## Overview

Creating a Russian translation submod for an existing HOI4 mod involves:
1. Extracting English localizations from the parent mod
2. Auto-translating keys that match vanilla HOI4
3. Marking remaining keys for manual/LLM translation
4. Validating the output

## Step-by-Step Process

### 1. Locate Parent Mod Files

Steam Workshop mods are downloaded to:
```
G:/SteamLibrary/steamapps/workshop/content/394360/<mod_id>/
```

Note: Game ID is **394360** (HOI4), NOT 236850 (another Paradox game).

Find the `.mod` file in the PDX user folder:
```
C:/Users/<user>/Documents/Paradox Interactive/Hearts of Iron IV/mod/ugc_<mod_id>.mod
```

This file contains `path=` pointing to the actual mod content.

### 2. Create Submod Structure

```
SubmodName/
├── .gitignore
├── README.md
├── translate.py           # Auto-translation script
├── translate_llm.py       # LLM-based translation script
└── SubmodName/            # Mod content (uploaded to Workshop)
    ├── descriptor.mod     # dependencies={ "Parent Mod Name" }
    ├── thumbnail.png      # 256x256 PNG
    └── localisation/
        ├── xxx_l_russian.yml
        └── replace/
            └── xxx_l_russian.yml
```

### 3. descriptor.mod for Submods

```pdx
version="1.13.0"
tags={
    "Translation"
    "Localization"
}
name="Parent Mod - Russian Translation"
supported_version="1.18.2.0"
dependencies={ "Parent Mod Name" }
```

The `dependencies` field is critical — it tells the launcher to load this mod AFTER the parent.

### 4. Auto-Translation Script

The `translate.py` script uses value-matching with £-code stripping:

1. Parse ALL vanilla English files → dict: `key → value` (123,000+ keys)
2. Parse ALL vanilla Russian files → dict: `key → translation` (141,000+ keys)
3. Build reverse lookup: `stripped_value → translation`
4. For each mod key:
   - Strip £-codes, normalize whitespace
   - Look up in reverse dictionary
   - If match → use vanilla Russian translation + reattach mod's £-codes
   - If no match → mark with `/* TODO */`

**Coverage:** ~56% of keys auto-translated (varies by mod)

### 5. LLM Translation Script

### 5. LLM Translation Script

For remaining TODO keys, use `translate_llm.py`:

```bash
# Create .env with API key
echo "LLM_API_KEY=*** > .env
echo "LLM_API_BASE=https://opencode.ai/zen/go/v1" >> .env
echo "LLM_MODEL=deepseek-v4-flash" >> .env

# Run translation (default batch size 1000)
python translate_llm.py

# Custom batch size
python translate_llm.py --batch-size 500

# Preview without API calls
python translate_llm.py --dry-run
```

The script uses the `openai` library (NOT urllib — Cloudflare blocks raw requests):
- Finds all `/* TODO */` keys across all files
- Sends batches of 1000 keys to LLM API
- Prompt includes formatting rules (keep £-codes, §-colors, $-vars, script expressions)
- Applies translations back to files
- Saves progress in `.translate_progress.json` for resume

**Pitfall:** Do NOT use `urllib.request` for API calls — Cloudflare error 1010 blocks them. Always use `openai` library:
```python
from openai import OpenAI
client = OpenAI(api_key="...", base_url="https://opencode.ai/zen/go/v1")
resp = client.chat.completions.create(model="deepseek-v4-flash", messages=[...])
```

**User preference:** Keep scripts simple. Use `openai` library with minimal parameters — no manual temperature, max_tokens, or retry logic. The library handles these automatically.

**Batch size:** 1000 keys per API call is efficient. Smaller batches (50-100) waste API calls; larger batches may hit token limits.

### 6. Validation

#### Python Validation (recommended for translation submods)

```python
# Check: BOM, language header, key format, empty values, duplicates
python validate_loc.py
```

#### hoi4-mcp-cli (limited for submods)

**Problem:** `loc_validate` requires `map/definition.csv` which translation submods don't have.

**Fix:** Patch `hoi4-mcp-cli.js` to check for `descriptor.mod` instead. See `references/hoi4-mcp-cli-patch.md`.

**Workaround:** Use Python validation instead.

### 7. Publishing

1. Ensure `thumbnail.png` exists (256x256)
2. Ensure `.mod` file has correct `path=`
3. Upload via SteamCMD or Paradox Launcher

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Mod not appearing in launcher | Wrong `path=` in .mod file | Check path points to correct folder |
| Russian text not showing | Missing UTF-8 BOM | Add BOM to all .yml files |
| Keys show English instead of Russian | Submod loaded BEFORE parent | Move submod below parent in load order |
| hoi4-mcp-cli finds 0 files | Missing map/definition.csv | Use Python validation instead |
| £-codes duplicated in output | Not stripping vanilla £ before adding mod's | Strip all £ first, then prepend mod's |

## Key Regex Patterns

```python
# Parse key:value from HOI4 .yml (handles both :0 and no version)
KEY_RE = re.compile(r'^([^:]+?):\d*\s+"(.*)"$')

# Extract £-icon codes
POUND_RE = re.compile(r'£\\S+')

# Match TODO markers
TODO_RE = re.compile(r'^ (\\S+): "(/\\* TODO \\*/ )(.*)"$')
```
