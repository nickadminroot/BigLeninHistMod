# AGENTS.md — BigLeninHistMod

## Project

BigLeninHistMod is a vanilla-like, multiplayer-oriented historical HOI4 mod focused on balance and performance.

- Shipped game content lives under `BigLeninHistMod/`.
- Modify files outside that directory only when the task explicitly concerns tooling, documentation, tests, or agent configuration.
- Preserve unrelated user changes and prefer the smallest vanilla-like implementation.

## Required workflow

1. Read the matching project skill before editing:
   - `hoi4-mod-development` for HOI4 scripting, localization, validation, and publishing;
   - `hoi4-map` for map work;
   - `hoi4-gui` for GUI/GFX work;
   - `pi-subagents` for delegation.
2. Extract HOI4-specific terms and exact identifiers from the user's request. Use the standalone `docs-search` CLI for game-sensitive terms, then verify against local files.
3. Search the mod and local vanilla data with `rg`; do not guess Clausewitz syntax or engine behavior.
4. Use `scripts/hoi4-mcp-cli.js` for script, reference, scope, mod-structure, and localization operations. Use `scripts/docs-search.mjs` (or `scripts/docs-search.cmd` on Windows) for local documentation search. Both CLIs are intentionally one-shot: run at most one CLI invocation per `bash` tool call. Do not hide repeated calls in shell loops or chained commands; issue 2-4 independent read-only calls as separate parallel `bash` tool calls instead, and never parallelize write tools.
5. Keep effects, visible tooltips, idea variants, and English/Russian localization synchronized.
6. When adding a focus, idea, or dynamic modifier that needs a new custom icon, keep a valid fallback `icon`/`picture` in the script and create `icon-manifests/focus/<focus_id>.json`, `icon-manifests/idea/<idea_id>.json`, or `icon-manifests/dynamic_modifier/<modifier_id>.json` with `scripts/icon-manifest.py new`. Do not generate images, edit the shared generated GFX, or switch to the custom sprite during normal gameplay implementation. Follow [GENERATING_ICONS.md](GENERATING_ICONS.md), including its parallel-branch integration workflow.
7. Validate the changed files and references before reporting completion. For deferred icons, run `python scripts/icon-manifest.py validate`.

The local documentation corpus is under `docs/rag/corpus/`. The standalone `scripts/docs-search.mjs` CLI combines exact grep-style matching, BM25, and optional semantic RAG; use it instead of automatic context injection or codebase-memory. It works outside pi and has a Windows `scripts/docs-search.cmd` wrapper.

```bash
node scripts/docs-search.mjs --query "add_stability country scope" --mode hybrid --limit 5
node scripts/docs-search.mjs --status
node scripts/docs-search.mjs --reindex  # requires RAG_API_KEY
```

Use `--json` for scripts/IDE integrations, `--root <path>` when running against another checkout, and `scripts/docs-search.cmd` instead of `node ...` on Windows if preferred.

## Project-specific constraints

- Local vanilla files are authoritative when examples or external documentation conflict.
- Multiplayer determinism and performance take priority over decorative complexity.
- Do not introduce random or hidden rewards without an accurate visible tooltip.
- Do not run destructive commands or Git lifecycle operations without explicit user approval.
- Run `python scripts/hoi4-smoke-windows.py` only when the user explicitly requests the Windows smoke test; follow the serialized procedure below.
- Use `pwsh`, not legacy Windows PowerShell (`powershell`), for PowerShell commands. When invoking it through Bash, single-quote the `-Command` script so Bash does not expand PowerShell variables such as `$_`.

## Steam Workshop updates

For SteamCMD paths, credentials, VDF preparation, Steam Guard confirmation, and the upload command, follow [STEAM_WORKSHOP_UPDATE.md](docs/STEAM_WORKSHOP_UPDATE.md).

## Windows smoke test

Run the test from the repository root in native Windows PowerShell. Close HOI4 and Paradox Launcher first, and never run the game or another smoke test concurrently from any checkout or worktree.

Minimal run with the script defaults:

```powershell
python scripts/hoi4-smoke-windows.py
```

Common overrides for a non-default installation or a retained diagnostic run:

```powershell
$env:HOI4_DIR = "G:\SteamLibrary\steamapps\common\Hearts of Iron IV"
$env:PDX_USER_DIR = "G:\Documents\Paradox Interactive\Hearts of Iron IV"
$env:SMOKE_TIMEOUT = "180s"
$env:SMOKE_TAG = "SOV"
$env:HOI4_SMOKE_KEEP_DATA = "1"
python scripts/hoi4-smoke-windows.py
```

- `HOI4_DIR` must contain `hoi4.exe`; `PDX_USER_DIR` is the active Paradox user-data directory. The defaults are defined in the script.
- `SMOKE_TIMEOUT` accepts seconds or `s`, `m`, `h`, and `d` suffixes. A timeout is the normal way the test stops HOI4: the script terminates the launched process tree and then evaluates `logs/error.log`.
- The script temporarily replaces and restores `PDX_USER_DIR/dlc_load.json`, `PDX_USER_DIR/mod/BigLeninHistMod.mod`, and `HOI4_DIR/cream_api.ini` when present. An interrupted or concurrent run can leave `.hoi4-smoke-backup` files, so inspect them before retrying after an abnormal termination.
- `PDX_SMOKE_HOME` selects a fixed artifact directory and implies retention; it does **not** isolate the shared HOI4 user-data directory or game installation.
- A failure retains `hoi4-launch.log`, `matching-errors.txt`, and `crashes/` under the printed smoke directory. A passing run removes temporary artifacts unless `HOI4_SMOKE_KEEP_DATA=1` or `PDX_SMOKE_HOME` is set.
- Optional diagnostics: `SMOKE_MAX_ERROR_ENTRIES` and `SMOKE_MAX_ENTRY_LINES` limit the summary; `HOI4_SMOKE_CREAM_UNLOCKALL=0` disables the temporary `unlockall` change. `SMOKE_STRICT_BASELINE=1` disables the exact pre-restoration warning allowlist. Use `SMOKE_INCLUDE_PATTERN` only for explicitly reported targeted diagnosis because it can hide unrelated errors.
- Report the command and overrides used, PASS/FAIL and exit status, retained artifact path, relevant `error.log` sources, and any remaining in-game checks.
- If smoke fails it does not mean game fails to start or crashes. Most of the time it keeps working (and user can check the changes with his own eyes) so timeout is needed to kill the process.

## Worktree helper scripts

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/git-newworktree.ps1 -Branch "<name>"

## Validation commands

The MCP CLI is quiet and one-shot: every normal call owns its process and exits, so it cannot leave a stuck background server. Use exactly one CLI invocation per `bash` tool call. For multiple independent read-only checks, issue separate `bash` tool calls through `multi_tool_use.parallel` with bounded concurrency (normally 2-4); do not use shell loops, command chains, or parallel write operations. File arguments may be relative to mod content (preferred), absolute paths inside mod content, or existing paths relative to the caller's current working directory.

Choose checks that match the change:

```powershell
node scripts/docs-search.mjs --query "add_stability country scope" --mode hybrid --limit 5
scripts/docs-search.cmd --query "country scope stability" --mode grep --limit 5
node scripts/hoi4-mcp-cli.js script_validate_file --file "common/national_focus/SOV.txt"
node scripts/hoi4-mcp-cli.js script_get_references --name "SOV_identifier"
node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true
```

Report commands run, results, and any in-game checks still required.
