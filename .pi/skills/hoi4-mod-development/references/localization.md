# Localization

## Rules

1. **All `.yml` files MUST start with UTF-8 BOM** (`\xEF\xBB\xBF`)
2. **Every visible key needs English AND Russian** when both language folders exist
3. Key format: `key_name:0 "value"` (the `:0` is version, always 0)
4. Language line: `l_english:` (first non-comment line)

## File Structure

```yaml
# localisation/english/my_mod_l_english.yml
l_english:
 my_mod_event.1.t: "Event Title"
 my_mod_event.1.desc: "Event description text."
 my_mod_event.1.a: "Option A text"
 my_mod_event.1.b: "Option B text"
```

```yaml
# localisation/russian/my_mod_l_russian.yml
l_russian:
 my_mod_event.1.t: "Название события"
 my_mod_event.1.desc: "Описание события."
 my_mod_event.1.a: "Вариант А"
 my_mod_event.1.b: "Вариант Б"
```

## Key Naming Conventions

| Element | Name Pattern | Description Pattern |
|---------|-------------|---------------------|
| Focus | `TAG_focus_id` | `TAG_focus_id_desc` |
| Idea | `TAG_idea_id` | `TAG_idea_id_desc` |
| Event | `ns.number.t` | `ns.number.desc` |
| Event option | `ns.number.a`, `ns.number.b` | — |
| Decision | `TAG_decision_id` | `TAG_decision_id_desc` |
| Custom tooltip | `TAG_something_tt` | — |
| Technology | `tech_name` | — |

## Tooltip Keys

Custom tooltips are normal loc keys, usually ending in `_tt`:

```pdx
# In script:
custom_effect_tooltip = TAG_my_effect_tt

# In loc:
l_english:
 TAG_my_effect_tt: "This effect grants +10% factory output for 365 days"
```

**Tooltip formatting helpers:**
```yaml
generic_skip_one_line_tt: " "                    # Blank line separator
generic_skip_two_lines_tt: "  "                  # Two blank lines
TAG_effect_tt: "Effect: +[?var] stability"      # Dynamic variable display
```

## Dynamic Text in Loc

Use `[?variable]` to display dynamic values:

```yaml
my_tooltip_tt: "Current value: [?my_country.my_variable]"
```

## Loc File Naming

Use descriptive names with `_l_english.yml` / `_l_russian.yml` suffix:
```
localisation/english/my_events_l_english.yml
localisation/russian/my_events_l_russian.yml
localisation/english/my_focuses_l_english.yml
localisation/russian/my_focuses_l_russian.yml
```

## UTF-8 BOM

The BOM is the first 3 bytes: `EF BB BF`. In Python:
```python
with open(path, 'rb') as f:
    content = f.read()
if not content.startswith(b'\xef\xbb\xbf'):
    content = b'\xef\xbb\xbf' + content
```

Or use the hoi4-mcp-cli loc_set/loc_bulk_set which handles BOM automatically.

## Localization Validation

```bash
# Validate all loc:
node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true

# Search for loc keys:
node scripts/hoi4-mcp-cli.js loc_search --query "TAG_"

# Get a specific key's value:
node scripts/hoi4-mcp-cli.js loc_get --key "TAG_focus_id"

# Set a loc key (creates file with BOM):
node scripts/hoi4-mcp-cli.js loc_set --key "TAG_new_focus" --value "New Focus Name"

# Set multiple keys at once:
node scripts/hoi4-mcp-cli.js loc_bulk_set --entries '[{"key":"TAG_a","value":"A"},{"key":"TAG_b","value":"B"}]'

# Set Russian loc:
node scripts/hoi4-mcp-cli.js loc_set --key "TAG_new_focus" --value "Новый фокус" --language russian
```

## Translation Submods

When creating a submod that only provides translations (no other content):

1. **File location**: Place Russian `.yml` files directly in `localisation/` (not in `localisation/russian/` subfolder — the filename suffix determines the language)
2. **Naming**: Copy each `xxx_l_english.yml` as `xxx_l_russian.yml`, keeping the same directory structure
3. **Language header**: Change first line from `l_english:` to `l_russian:`
4. **Override semantics**: When loaded after the parent mod, submod's Russian files replace the parent's Russian files entirely — partial overrides are not supported
5. **UTF-8 BOM required**: Same as any `.yml` file — `l_russian:` header alone is not enough

Example structure for a translation submod:
```
MyTranslationMod/
├── descriptor.mod
└── localisation/
    ├── horst_focus_l_russian.yml    # Overrides parent's Russian loc
    ├── horst_events_l_russian.yml
    └── replace/
        └── aat_focus_l_russian.yml  # Overrides vanilla replacements
```

## Auto-Translation from Vanilla

When creating a translation submod, most keys can be auto-translated by matching against vanilla HOI4's localization. There are three approaches in order of increasing coverage:

### Approach 1: Key+Value Matching (basic)

For each key in the mod's English file, check if the key AND value match vanilla exactly. If yes, use vanilla Russian translation.

- Coverage: ~38% (misses renamed keys, modified values)
- Use case: Quick and safe, only translates exact copies

### Approach 2: Value-Only Matching (recommended)

**Compare normalized English values (whitespace stripped) instead of keys.** This catches cases where the mod renamed a key but kept the same text.

- Coverage: ~51%
- How it works:
  1. Build vanilla_en dict: `key → value` (single global dict across all files)
  2. Build vanilla_ru dict: `key → translation`
  3. Build reverse lookup: `normalize(value) → translation`
  4. For each mod key: `normalize(mod_value)` → look up → use translation
- Normalization: `re.sub(r'\s+', '', value)` — strips all whitespace for comparison

### Approach 3: Strip £-Codes + Value Matching (best)

HOI4 localization uses `£word` tokens for icons (e.g. `£civ_factory`, `£tech_mod`). Mods often ADD extra £-codes that vanilla doesn't have. Strip them before comparison, then reattach the mod's £-codes to the translation.

- Coverage: ~56%
- Algorithm:
  1. Extract `£\S+` tokens from mod value
  2. Strip all £-tokens and normalize whitespace → `stripped_mod_value`
  3. Compare with vanilla (also stripped) → find match
  4. Take vanilla Russian translation, strip any existing £-codes
  5. Prepend the MOD's £-codes: `"£icon1 £icon2  Russian text"`

```python
POUND_RE = re.compile(r'£\S+')

def strip_pound(value):
    """Remove £-codes and normalize for comparison."""
    return re.sub(r'\s+', '', POUND_RE.sub('', value))

def extract_pound(value):
    """Extract £-codes from value, preserving order."""
    return POUND_RE.findall(value)
```

**Why this works:** The mod may add `£civ_factory  Max Factories in a State` while vanilla has just `Max Factories in a State`. After stripping £, both become `MaxFactoriesinaState` → match → use vanilla Russian `Максимум фабрик в регионе` → prepend mod's £: `£civ_factory  Максимум фабрик в регионе`.

### General Notes

- **Single global dictionary:** Parse ALL vanilla files into ONE dict, not per-file. Mod files mix content from many vanilla sources.
- **Marker:** Use `/* TODO */` for untranslated keys (easy to grep, easy to find remaining work).
- **Script:** See `scripts/translate_vanilla.py` — takes vanilla and mod paths, outputs Russian files with auto-translations and TODO markers. Re-runnable after mod updates.
- **Typical results:** replace/ files → ~90-100% auto-translated. Root mod files with custom content → varies (commonly 0-50%).

## Common Mistakes

1. **Missing BOM** — HOI4 silently ignores the entire file
2. **Wrong language line** — Must be `l_english:` or `l_russian:`, nothing else
3. **Missing quotes** — Values must be in double quotes: `key: "value"`
4. **Special characters** — Escape `"` as `\"` in values
5. **One language missing** — If you have `english/` folder, add `russian/` too
