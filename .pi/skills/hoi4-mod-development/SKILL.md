---
name: hoi4-mod-development
description: "Use when developing, editing, validating, or debugging Hearts of Iron IV mods. Covers Clausewitz scripting, focus trees, events, decisions, ideas, technologies, localization, units, characters, AI, mapping, GUI, GFX, sound, multiplayer compatibility, and Steam Workshop publishing."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [hoi4, hearts-of-iron, paradox, clausewitz, modding, grand-strategy, pdx-scripting]
    related_skills: [plan, systematic-debugging]
---

# Hearts of Iron IV Mod Development

Comprehensive skill for developing HOI4 mods using Clausewitz/PDX script language. Covers all modding areas from focus trees to Steam Workshop publishing. Designed for AI agents working on HOI4 mods — provides structured references, code templates, universal scripts, and the full HOI4 scripting documentation corpus.

## When to Use

- Creating or modifying HOI4 mod files (focuses, events, decisions, ideas, tech, etc.)
- Writing or editing Clausewitz/PDX script (.txt files)
- Adding or modifying localization (.yml files)
- Debugging mod errors via smoke tests
- Validating mod scripts and references
- Publishing mods to Steam Workshop

## When NOT to Use

- For Paradox games other than HOI4 (EU4, CK3, Stellaris use different scripting)
- For real-time map editing (use hoi4-map skill if available)
- For GUI layout editing (use hoi4-gui skill if available)

## Translation Submods

When creating a submod that provides Russian localization for an existing mod:

### Auto-Translation Approach

1. **Build vanilla dictionaries**: Parse ALL vanilla English/Russian .yml files into single global dicts
2. **Value-matching (not key-matching)**: Compare normalized English values (strip whitespace, £-icons, §-codes, $-vars, \n, %N) against vanilla values
3. **Match found**: Use vanilla Russian translation, reattach mod's £-codes
4. **No match**: Mark with `/* TODO */` for manual/LLM translation
5. **Coverage**: ~56% auto-translated from vanilla, rest needs LLM

### Key: "submod" in HOI4 context

A "submod" is a Steam Workshop concept — a separate mod that extends another mod without being a fork. It does NOT contain the original mod's files. It loads AFTER the parent mod via `dependencies={ "Parent Mod Name" }` in descriptor.mod.

### LLM Translation

For remaining untranslated keys, use OpenAI-compatible API (e.g. DeepSeek V4 Flash):
```python
from openai import OpenAI
client = OpenAI(api_key=KEY, base_url="https://opencode.ai/zen/go/v1")
resp = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[{"role": "user", "content": f"Translate HOI4 loc EN→RU: {keys}"}]
)
```
No need for temperature/max_tokens — keep it simple.

## Mod Structure — Two Descriptors

HOI4 uses **two descriptor files** for each mod:

### 1. Launcher Descriptor (`mods/<ModName>.mod`)

Located in `Documents/Paradox Interactive/Hearts of Iron IV/mod/`. The Paradox Launcher reads this file to find your mod.

```pdx
version="1.0"
tags={
    "Balance"
    "Historical"
}
name="MyMod"
supported_version="1.18.*"
path="G:/path/to/your/mod/MyMod"    # Points to the actual mod folder
remote_file_id="123456789"          # Steam Workshop ID (set after first upload)
dependencies={ "Parent Mod Name" }  # Optional: makes this a submod
# replace_path directives here too
```

Key fields:
- `path=` — absolute path to the mod content folder
- `remote_file_id=` — Steam Workshop ID (set after first upload)
- `dependencies=` — list of mod names this mod requires (loaded AFTER them; makes this a submod)
- `replace_path=` — directories that fully replace vanilla

### Submods (Dependencies)

A "submod" in HOI4 is a separate mod that extends another mod. It is NOT a fork — it does not contain the parent's files. The Paradox Launcher loads mods in order: parent first, then submod. The submod's files override the parent's files of the same path.

To create a submod:
1. Add `dependencies={ "Parent Mod Name" }` to both `.mod` and `descriptor.mod`
2. The name must match the parent mod's `name=` field exactly
3. Only include files you want to override/extend — do NOT copy the parent's content
4. In the launcher, the submod must appear BELOW the parent mod in load order

### 2. Mod Descriptor (`<ModFolder>/descriptor.mod`)

Inside the actual mod content folder. Same content as the launcher descriptor but **without the `path=` line**.

```pdx
version="1.0"
tags={ "Balance" "Historical" }
name="MyMod"
supported_version="1.18.*"
# replace_path directives (same as launcher descriptor)
# NO path= line here
```

### 3. Steam Workshop Descriptor (`mods/ugc_<ID>.mod`)

Auto-created by Steam when downloading subscribed mods. **Ignore this file** — it's managed by Steam.

## Repository vs Mod Folder

**Recommended structure** — mod folder inside repository:

```
mods/MyMod/                        ← REPOSITORY (git, scripts, configs)
├── .git/
├── scripts/
├── AGENTS.md
├── docs/
├── .vscode/
├── MyMod/                         ← MOD FOLDER (uploaded to Steam Workshop)
│   ├── descriptor.mod
│   ├── thumbnail.png
│   ├── common/
│   ├── events/
│   ├── history/
│   ├── localisation/
│   ├── interface/
│   ├── gfx/
│   ├── map/
│   ├── music/
│   └── sound/
└── .gitignore                     # Exclude mod folder from git if needed
```

**Why this structure:**
- Repository contains `.git`, scripts, agent configs, documentation — **not uploaded to Workshop**
- Mod folder contains only game content — **uploaded to Workshop**
- Avoids uploading dev files to Steam Workshop
- Keeps repo clean with `.gitignore`

**Alternative** — repo root IS the mod folder (not recommended):
```
mods/MyMod/                        ← BOTH repo AND mod
├── .git/                          # These get uploaded to Workshop!
├── scripts/                       # These get uploaded too!
├── AGENTS.md
├── descriptor.mod
├── common/
└── ...
```

This works but risks uploading non-game files to Workshop.

## Mod Folder Location

The mod folder can be **anywhere on disk** — the launcher finds it via the `path=` in the `.mod` file. Common locations:
- `mods/<ModName>/` — same directory as launcher descriptors (most common)
- Custom Steam library paths
- Any absolute path

## Finding Your Mod

The launcher scans `mods/` for `*.mod` files, reads each `path=`, and loads mod content from there. If `path=` is wrong, the mod won't appear in the launcher.

## Quick Reference — Mod Content Structure

```
MyMod/                             ← Mod content folder (inside repo)
├── descriptor.mod                 # Mod metadata (NO path= line)
├── thumbnail.png                  # Workshop preview image
├── common/                        # Gameplay definitions
│   ├── national_focus/            # Focus trees
│   ├── ideas/                     # National spirits
│   ├── decisions/                 # Decisions
│   ├── events/                    # Event files
│   ├── technologies/              # Tech trees
│   ├── on_actions/                # On-action hooks
│   ├── scripted_effects/          # Reusable effects
│   ├── scripted_triggers/         # Reusable triggers
│   ├── characters/                # Character definitions
│   ├── units/                     # Division templates
│   │   └── equipment/             # Equipment definitions
│   └── military_industrial_organization/
│       └── organizations/         # Per-country MIOs
├── events/                        # Event scripts
├── history/
│   ├── countries/                 # Country setup
│   ├── states/                    # State data
│   ├── units/                     # Starting units
│   └── general/                   # General assignments
├── localisation/
│   ├── english/                   # English .yml (UTF-8 with BOM)
│   └── russian/                   # Russian .yml (UTF-8 with BOM)
├── interface/                     # GUI definitions (.gui)
├── gfx/                           # Graphics sprites, 3D models
├── map/                           # Strategic regions, supply areas
├── music/                         # Music files
└── sound/                         # Sound effects
```

## Submods (Extension / Translation Mods)

A **submod** is a separate Steam Workshop mod that extends or modifies another mod. It is NOT a git submodule — it's a concept from the modding community. The submod loads AFTER the parent mod in the launcher, so its files override the parent's.

### How Submods Work

1. The submod has its own `.mod` and `descriptor.mod` with a `dependencies` field
2. The `dependencies` name must match the parent mod's `name=` exactly
3. The submod is loaded after the parent in the launcher (user controls load order)
4. The submod contains ONLY the files it needs to override/add (not the parent's full content)

### .mod File for Submods

```pdx
version="1.13.0"
tags={
    "Translation"
    "Localization"
}
name="Parent Mod - Russian Translation"
supported_version="1.18.2.0"
dependencies={ "Parent Mod Name" }
path="G:/path/to/submod/content"
```

Key difference from regular mods: **`dependencies={ "Parent Mod Name" }`** declares the submod relationship.

### Typical Use Cases

- **Translation mods**: Only contain `localisation/` folder with translated `.yml` files
- **Compatibility patches**: Fix conflicts between two mods
- **Content extensions**: Add new focuses, events, decisions on top of existing mod

### Translation Submod Structure

```
MyTranslationMod/
├── descriptor.mod              # dependencies={ "Original Mod" }
└── localisation/
    ├── xxx_l_russian.yml       # Russian translations (UTF-8 BOM, l_russian: header)
    └── replace/                # Replacements for vanilla loc files
        └── xxx_l_russian.yml
```

**File naming convention**: `original_name_l_russian.yml` (replace `_l_english.yml` suffix)

### Pitfall: Existing Files in Parent Mod

Many mods already include partial translations. When creating a translation submod:
- The submod's Russian files will override the parent's Russian files
- Do NOT assume existing translations are correct — they may be outdated or wrong
- Create fresh Russian files for ALL keys, even if the parent already has some

---

## Core Concepts

### Clausewitz/PDX Script Syntax

HOI4 uses a key-value scripting language called Clausewitz (or PDX script):

```pdx
# Comments start with #
key = value                    # Simple assignment
key = {                        # Block (nested scope)
    subkey = value
    subkey = {
        nested = value
    }
}
```

**Scopes** determine what an effect/trigger operates on:
- `country` — the current country
- `state` — a geographic state
- `character` — a character/leader
- `unit` — a military unit

### Key Timing Constants

| Constant | Value | Notes |
|----------|-------|-------|
| `FOCUS_POINT_DAYS` | 7 | Focus `cost = N` = N × 7 days |

### File Encoding

- `.yml` localization: **UTF-8 with BOM** (byte order mark `\xEF\xBB\xBF`)
- `.txt` script files: UTF-8 or ASCII, CRLF line endings preferred on Windows

---

## Detailed References

Load sub-files for in-depth guidance on each area:

| Reference | File | Covers |
|-----------|------|--------|
| Focus Trees | `references/focus-trees.md` | Creating, modifying, deleting focuses |
| Events | `references/events.md` | Event structure, triggers, effects, chains |
| Decisions | `references/decisions.md` | Decisions, categories, missions |
| Ideas & Spirits | `references/ideas.md` | National spirits, modifier vs equipment_bonus |
| Technologies | `references/technologies.md` | Tech trees, research, doctrines, equipment |
| Localization | `references/localization.md` | Loc rules, bilingual support, tooltips, translation submods |
| Translation Workflow | `references/translation-workflow.md` | Full guide: submod structure, auto-translate, LLM translate, validate, publish |
| LLM Translation | `references/llm-translation.md` | Batch translate TODO keys via API |
| Units & Equipment | `references/units-equipment.md` | Division templates, equipment stats |
| Characters | `references/characters.md` | Character definitions, traits, roles |
| Scripting | `references/scripting.md` | Scripted effects, triggers, variables, flags |
| On Actions | `references/on-actions.md` | Event triggers, game hooks |
| AI & Strategy | `references/ai.md` | AI strategy, plans, naval AI |
| Mapping | `references/mapping.md` | States, strategic regions, supply areas |
| GFX & Interface | `references/gfx-interface.md` | Sprites, 3D models, GUI definitions |
| Sound & Music | `references/sound-music.md` | Sound effects, music |
| Multiplayer | `references/multiplayer.md` | Sync, desync prevention |
| Tools | `references/tools.md` | hoi4-mcp-cli, smoke test, validation, merge vanilla |
| Publishing | `references/publishing.md` | Steam Workshop upload |
| Translation | `references/translation-submod.md` | Creating translation submods, auto-translate, LLM |

---

## Documentation Corpus

Full HOI4 scripting documentation in `corpus/`:

| File | Content |
|------|---------|
| `corpus/effects_documentation.md` | All effects with scope details |
| `corpus/triggers_documentation.md` | All triggers with scope details |
| `corpus/modifiers_documentation.md` | All modifiers |
| `corpus/decisions_documentation.md` | Decision system docs |
| `corpus/doctrines_*.md` | Doctrine system docs |
| `corpus/on_actions_documentation.md` | On-action hooks |
| `corpus/units_equipment_documentation.md` | Unit/equipment system |
| `corpus/loc_objects_documentation.md` | Localization objects |
| `corpus/loc_formatter_documentation.md` | Loc formatting |
| `corpus/script_concept_documentation.md` | Script concepts |
| `corpus/dynamic_variables_documentation.md` | Variable system |
| `corpus/factions_documentation.md` | Faction system |
| `corpus/resources_documentation.md` | Resource system |
| `corpus/operations_documentation.md` | Intelligence operations |
| `corpus/intelligence_agency_upgrades_documentation.md` | Agency upgrades |
| `corpus/military_industrial_organization_*.md` | MIO system |
| `corpus/equipment_groups_documentation.md` | Equipment groups |
| `corpus/peace_conference_cost_modifiers_documentation.md` | Peace conference |

---

## Templates

Code templates for common mod elements:

| Template | File |
|----------|------|
| Focus | `templates/focus.txt` |
| Focus + Spirit | `templates/focus-with-spirit.txt` |
| Event | `templates/event.txt` |
| Decision | `templates/decision.txt` |
| Idea / Spirit | `templates/idea.txt` |
| Technology | `templates/technology.txt` |
| Character | `templates/character.txt` |
| Scripted Effect | `templates/scripted-effect.txt` |
| Localization Keys | `templates/localization-key.txt` |

---

## Scripts

Located in `scripts/`. Python scripts auto-detect HOI4 installation path.

### Python Scripts

| Script | Purpose |
|--------|---------|
| `scripts/hoi4_detect.py` | Universal HOI4 path detection (imported by other scripts) |
| `scripts/hoi4-smoke.py` | Cross-platform smoke test (Linux/macOS/Windows) |
| `scripts/hoi4-smoke-windows.py` | Windows-specific smoke test with CreamAPI |
| `scripts/merge-vanilla.py` | Universal merge vanilla files into mod |
| `scripts/translate_vanilla.py` | Auto-translate mod loc by matching vanilla EN→RU values |
| `scripts/translate_llm.py` | Batch translate remaining TODO keys via LLM API |
| `scripts/validate_loc.py` | Validate localization files (BOM, headers, keys, duplicates) |
| `scripts/hoi4_workshop_upload.py` | SteamCMD Workshop upload (auto-generates VDF) |

**Workshop upload:** Store credentials in `.env` file (see `.env.example`). Steam Guard mobile authenticator requires phone confirmation on every login.

### JavaScript Scripts

| Script | Purpose |
|--------|---------|
| `scripts/hoi4-mcp-cli.js` | CLI for script search, validation, localization, effects lookup |
| `scripts/mcp/clausewitzMcp.js` | Clausewitz parser MCP server |
| `scripts/mcp/mapDataLoader.js` | Map data loader |
| `scripts/mcp/mapMcpServer.js` | Map MCP server |
| `scripts/mcp/imageToMap.js` | Image to map converter |

**First-time setup:** `bash scripts/setup.sh` (or `scripts\setup.bat` on Windows)

### Persistent CLI daemon

Normal `hoi4-mcp-cli.js` calls use a quiet persistent daemon rather than rebuilding the mod index in every Node.js process.

- Daemons are keyed by the canonical absolute mod-content path, so the main checkout and every Git worktree have isolated indexes.
- The first call builds the index; subsequent calls reuse it.
- Filesystem changes cause one full invalidation after a 750 ms debounce. The next request rebuilds the complete index.
- A daemon exits after 15 idle minutes by default.
- Use `--verbose` for timing diagnostics, `--stop-daemon` to stop the current worktree's daemon, and `--no-daemon` only to troubleshoot one-shot behavior.
- Do not stop the daemon between validation calls or invoke repeated calls with `--no-daemon`.

Optional environment overrides are `HOI4_MCP_DEBOUNCE_MS`, `HOI4_MCP_IDLE_MS`, and `HOI4_MCP_START_TIMEOUT_MS`.

### Auto-Detection

Scripts automatically find HOI4 by:
1. Checking `HOI4_DIR` environment variable
2. Parsing Steam `libraryfolders.vdf` for custom libraries
3. Searching common platform-specific paths

Scripts also auto-find `descriptor.mod` by searching CWD and one level of subdirectories (handles `repo/mod_name/` structure).

Set `HOI4_DIR` if auto-detection fails:
```bash
# Linux/macOS:
export HOI4_DIR="/path/to/Hearts of Iron IV"

# Windows:
set HOI4_DIR=G:\SteamLibrary\steamapps\common\Hearts of Iron IV
```

---

## hoi4-mcp-cli: Submod Support

The `hoi4-mcp-cli.js` tool now supports translation submods that don't have `map/definition.csv`:

- **Mod detection**: Looks for `descriptor.mod` as alternative to `map/definition.csv`
- **Map tools**: Gracefully disabled when map files missing (localization tools still work)
- **Usage**: Run from any directory containing the mod files or submod structure

**Patch instructions:** See `references/hoi4-mcp-cli-patch.md` for the exact code changes needed.

```bash
# For translation submods (no map files):
cd MyTranslationMod
node scripts/hoi4-mcp-cli.js loc_validate
node scripts/hoi4-mcp-cli.js loc_search --query "TODO"
```

## Common Pitfalls

1. **Localization BOM missing.** All `.yml` files MUST start with UTF-8 BOM.

2. **Wrong scope for effects.** `add_stability` is country-scoped; calling it in a state scope crashes.

3. **Duplicate modifier stacking.** Two ideas with the same modifier key add together. Use `swap_ideas` to replace.

4. **Missing localization keys.** Every visible key needs both EN and RU loc.

5. **`cost` is weeks not days.** Focus `cost = 5` = 35 days, not 5 days.

6. **replace_path resets entire directory.** You MUST provide ALL files for replaced paths.

7. **CRLF vs LF.** Mixed line endings cause parsing issues.

8. **Case sensitivity.** HOI4 is case-insensitive on Windows but case-sensitive on Linux servers.

9. **Bracket matching.** Every `{` must have a matching `}`.

10. **Debug mode.** Always test with `-debug_mode` flag.

11. **descriptor.mod in subdirectories.** Many HOI4 mod repos use `repo/mod_name/descriptor.mod` structure (mod content in a subdirectory). Scripts must search for `descriptor.mod` in both CWD and one level down: `Path(".").glob("*/descriptor.mod")`. The included scripts handle this automatically.

12. **HOI4 installation path varies.** Users install HOI4 in different Steam libraries. Always use `hoi4_detect.py` for path detection — it checks `HOI4_DIR` env var, parses `libraryfolders.vdf` for custom libraries, and falls back to common platform paths.

13. **Equipment variant errors on startup.** Smoke test may report "equipment category is not allowed" or "does not have any equipment variant" errors. These often come from `history/countries/` files referencing ship/equipment classes that need corresponding definitions in `common/units/equipment/`. Check `create_equipment_variant` blocks match defined equipment types.

14. **Include ALL script types in skill.** When creating a skill with tooling, include scripts in ALL languages used by the project (Python, JavaScript, shell, etc.), not just one. Check the source repo's `scripts/` directory for all script types before deciding what to copy.

15. **VDF syntax uses single braces.** VDF files use `{` and `}`, not `{{` and `}}`. When generating VDF in Python f-strings, use regular strings for braces: `vdf += '{\n'` not `vdf += '{{\n'`.

16. **.env file search locations.** When loading .env, check multiple locations: script directory, current working directory, and repo root. Users may place .env in any of these.

17. **SteamCMD PTY limitation.** The terminal PTY mode does not proxy stdin for subprocess interactive prompts. SteamCMD password prompts cannot be answered through PTY — use .env credentials or `--password` flag instead.

18. **Steam Guard mobile authenticator.** Steam Guard mobile (not email) requires user to confirm login on phone. Script should print clear instructions and wait. Session is saved after first confirmation — subsequent logins don't require it.

19. **hoi4-mcp-cli without map files.** The CLI requires `scripts/mcp/mapMcpServer.js` in a parent directory. For translation submods (no map/definition.csv), patch `resolveModContent()` in hoi4-mcp-cli.js to also check for `descriptor.mod`. Make MapDataLoader init optional with try/catch.

19. **YAML version number `:0` in .yml files.** HOI4 English `.yml` files use format `key:0 "value"` where `:0` is the string version number. Russian files omit it: `key: "value"`. Regex for parsing MUST handle both: `r'^([^:]+?):\d*\s+"(.*)"'`. Using `r'^(\S[^:]*?):\s*"(.*)"'` will miss all English keys. This is a common bug when writing translation scripts.

20. **Steam Workshop content path uses game ID 394360.** HOI4's Workshop content is at `steamapps/workshop/content/394360/<mod_id>/`, NOT `236850` (which is a different Paradox game). When searching for downloaded Workshop mods, check the correct game ID.

21. **£-codes in localization values.** HOI4 uses `£word` tokens for icons (e.g. `£civ_factory`, `£tech_mod`). Mods often ADD extra £-codes that vanilla doesn't have. When writing translation scripts: strip £-tokens before value comparison, then reattach the mod's £-codes to the Russian translation. Failure to strip £ causes false negatives in value matching. Regex: `re.compile(r'£\\S+')` to find, `POUND_RE.sub('', value)` to strip.

22. **LLM API authentication for translation scripts.** When using `translate_llm.py`, the API key must be available via environment variable (`LLM_API_KEY` or `OPENCODE_GO_API_KEY`) or `--api-key` flag. Some providers (opencode-go) require specific model names (e.g. `deepseek-v4-flash`). Test with a single API call before running full translation. Cloudflare error 1010 means the request is blocked — add proper User-Agent headers or use `requests` library instead of `urllib`.

23. **hoi4-mcp-cli requires map/definition.csv.** The `loc_validate` and `loc_search` tools walk up from CWD looking for `scripts/mcp/mapMcpServer.js`, and inside that script it expects `map/definition.csv` to identify the mod root. Translation submods (localisation-only) don't have map files. Fix: patch `hoi4-mcp-cli.js` to also check for `descriptor.mod` (see PR/commit), OR use Python validation instead.

24. **Use openai library for API calls, not urllib.** Cloudflare blocks raw `urllib.request` calls to opencode.ai with error 1010. Always use `pip install openai` and the `OpenAI` client, or `pip install requests`. The `openai` library handles headers, retries, and serialization properly.

---

## Verification Checklist

After any mod change:

- [ ] Validate file syntax: `node scripts/hoi4-mcp-cli.js script_validate_file --file "path/to/file.txt"`
- [ ] Validate localization: `node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true`
- [ ] Search for broken references: `node scripts/hoi4-mcp-cli.js script_get_references --name "my_new_id"`
- [ ] Run smoke test: `python scripts/hoi4-smoke.py` (cross-platform) or `python scripts/hoi4-smoke-windows.py` (Windows)
- [ ] Check error.log for new errors
- [ ] Verify localization appears in-game for both EN and RU
