# Translation Submod Guide

## Creating a Translation Submod

### Directory Structure
```
RepoRoot/
├── ModName/
│   ├── descriptor.mod (NO path= line)
│   ├── thumbnail.png
│   └── localisation/
│       ├── xxx_l_russian.yml (root files)
│       └── replace/
│           └── xxx_l_russian.yml (vanilla overrides)
├── .gitignore
└── translate.py
```

### descriptor.mod
```pdx
version="1.0.0"
tags={ "Localisation" "Translation" }
name="Mod Name — Russian Translation"
supported_version="1.19.*"
dependencies={ "Original Mod Name" }
remote_file_id="WORKSHOP_ID"
```

### File Requirements
- UTF-8 BOM: all .yml files must start with \xEF\xBB\xBF
- Language header: `l_russian:` (first non-comment line)
- CRLF line endings (Windows)
- Format: `key: "value"` (version number `:0` optional in Russian)

## Auto-Translation Script

The `translate.py` script in the repo uses value-matching:

1. Parse ALL vanilla English .yml → dict: key → value
2. Parse ALL vanilla Russian .yml → dict: key → translation
3. Build reverse lookup: normalized_value → translation
4. For each mod key: normalize value (strip whitespace, £, §, $, \n, %N)
5. If match → use vanilla Russian + reattach mod's £-codes
6. If no match → mark with `/* TODO */`

Coverage: ~56% auto-translated from vanilla HOI4.

## LLM Translation (for TODOs)

```python
from openai import OpenAI

client = OpenAI(api_key="KEY", base_url="https://opencode.ai/zen/go/v1")
resp = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[{"role": "user", "content":
        f"Translate HOI4 loc EN→RU. Keep §-codes, £-icons, $VARS$. "
        f"Return ONLY key: \"translation\" lines.\n\n{keys_text}"}]
)
```

## SteamCMD Upload

```bash
python scripts/hoi4_workshop_upload.py \
  --login USER --password PASS \
  --title "Mod Name — Russian Translation" \
  --description "$(cat description.txt)" \
  --changenote "$(cat changelog.txt)" \
  --preview ModName/thumbnail.png
```

- `publishedfileid` is auto-detected from `remote_file_id` in descriptor.mod
- Mobile authenticator requires phone confirmation on every login
- VDF generated automatically

## Common Issues

1. **Hardcoded tooltips**: Some mods use `custom_effect_tooltip = "English text"` in .txt scripts instead of localization keys. These CANNOT be translated via submod — would need replace_path + copying all script files.
2. **Korean/TODO placeholders**: Some mods have unfinished keys (TODO_NORDIC, Korean text). These have no English values to translate from.
3. **Duplicate keys**: Inherited from original mod — HOI4 uses last-loaded value.
