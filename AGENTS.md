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
2. Extract HOI4-specific terms and exact identifiers from the user's request. Use `docs_search` for game-sensitive terms, then verify against local files.
3. Search the mod and local vanilla data with `rg`; do not guess Clausewitz syntax or engine behavior.
4. Use `scripts/hoi4-mcp-cli.js` for script, reference, scope, mod-structure, and localization operations. Its default persistent daemon is the preferred mode; do not add `--no-daemon` or repeatedly stop it between validation calls.
5. Keep effects, visible tooltips, idea variants, and English/Russian localization synchronized.
6. Validate the changed files and references before reporting completion.

The local documentation corpus is under `docs/rag/corpus/`. `docs_search` combines exact grep-style matching, BM25, and optional semantic RAG; use it instead of automatic context injection or codebase-memory.

## Project-specific constraints

- Local vanilla files are authoritative when examples or external documentation conflict.
- Multiplayer determinism and performance take priority over decorative complexity.
- Do not introduce random or hidden rewards without an accurate visible tooltip.
- Do not run destructive commands or Git lifecycle operations without explicit user approval.
- Run `python scripts/hoi4-smoke-windows.py` only when the user explicitly requests the Windows smoke test; follow the serialized procedure below.
- Prefix shell commands with `rtk`.

## Windows smoke test

Run the test from the repository root in native Windows PowerShell. Close HOI4 and Paradox Launcher first, and never run the game or another smoke test concurrently from any checkout or worktree.

Minimal run with the script defaults:

```powershell
rtk python scripts/hoi4-smoke-windows.py
```

Common overrides for a non-default installation or a retained diagnostic run:

```powershell
$env:HOI4_DIR = "G:\SteamLibrary\steamapps\common\Hearts of Iron IV"
$env:PDX_USER_DIR = "G:\Documents\Paradox Interactive\Hearts of Iron IV"
$env:SMOKE_TIMEOUT = "180s"
$env:SMOKE_TAG = "SOV"
$env:HOI4_SMOKE_KEEP_DATA = "1"
rtk python scripts/hoi4-smoke-windows.py
```

- `HOI4_DIR` must contain `hoi4.exe`; `PDX_USER_DIR` is the active Paradox user-data directory. The defaults are defined in the script.
- `SMOKE_TIMEOUT` accepts seconds or `s`, `m`, `h`, and `d` suffixes. A timeout is the normal way the test stops HOI4: the script terminates the launched process tree and then evaluates `logs/error.log`.
- The script temporarily replaces and restores `PDX_USER_DIR/dlc_load.json`, `PDX_USER_DIR/mod/BigLeninHistMod.mod`, and `HOI4_DIR/cream_api.ini` when present. An interrupted or concurrent run can leave `.hoi4-smoke-backup` files, so inspect them before retrying after an abnormal termination.
- `PDX_SMOKE_HOME` selects a fixed artifact directory and implies retention; it does **not** isolate the shared HOI4 user-data directory or game installation.
- A failure retains `hoi4-launch.log`, `matching-errors.txt`, and `crashes/` under the printed smoke directory. A passing run removes temporary artifacts unless `HOI4_SMOKE_KEEP_DATA=1` or `PDX_SMOKE_HOME` is set.
- Optional diagnostics: `SMOKE_MAX_ERROR_ENTRIES` and `SMOKE_MAX_ENTRY_LINES` limit the summary; `HOI4_SMOKE_CREAM_UNLOCKALL=0` disables the temporary `unlockall` change. `SMOKE_STRICT_BASELINE=1` disables the exact pre-restoration warning allowlist. Use `SMOKE_INCLUDE_PATTERN` only for explicitly reported targeted diagnosis because it can hide unrelated errors.
- Report the command and overrides used, PASS/FAIL and exit status, retained artifact path, relevant `error.log` sources, and any remaining in-game checks.
- If smoke fails it does not mean game fails to start or crashes. Most of the time it keeps working (and user can check the changes with his own eyes) so timeout is needed to kill the process.

## Worktrees

Worktrees primarily isolate independent top-level Pi sessions that may write concurrently. The user normally organizes parallel work by assigning each main session its own worktree. Do not create a worktree merely because a session uses subagents.

### Main Pi sessions

A user instruction to "work in a worktree" authorizes the coordinating Pi session opened in the main repository to create a task branch/worktree, integrate the validated result back, and remove the task worktree and branch. It does not authorize force-removal, reset, rebase, or overwriting unrelated changes.

```powershell
# Create from the intended clean base; the helper checks out an existing branch.
rtk git branch "<name>" "<base-commit>"
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/git-newworktree.ps1 -Branch "<name>"

# Open a separate Pi/editor session only after "Worktree ready" and path verification.
rtk git worktree list
rtk code "../BigLeninHistMod.worktrees/<name>"
```

- Keep the coordinating session in the main repository. Open the implementation session with its working directory at the created worktree and perform all implementation, subagent work, and scoped validation there.
- One top-level writing session owns one worktree and task branch. Give concurrent sessions disjoint features/files where practical; coordinate shared files and identifiers before integration.
- After validation, the worktree session may commit its task branch. The coordinating main-repository session reviews the diff, merges the branch, validates the integrated tree, then removes the clean worktree and deletes the merged branch. Stop and report conflicts or uncommitted files instead of forcing cleanup.
- Run the Windows smoke test only once on the integrated tree and only when explicitly requested; worktrees do not isolate HOI4 user data or the game installation.

The helper supports Windows PowerShell 5.1, resolves the default sibling path as `../BigLeninHistMod.worktrees/<name>`, validates that the local branch exists, and refuses destinations inside the main repository. Treat any PowerShell or Git error as a failed setup; do not work in or blindly rerun a partially created worktree. Inspect `git worktree list` and `git status` first—the helper deliberately does not force-clean a worktree created before a later copy failure.

The helper symlinks extra files by default when present: `node_modules/`, `scripts/mcp/node_modules/`, `.pi/rag-cache.json`, `.env*`, and `.pnpm-store`. Use `-UseSymlinks:$false` to copy instead. Built-in switches include `-CopyEnv:$false`, `-CopyPiCache:$false`, and `-CopyNodeModules:$false`; entries in `$ExtraItems` are processed independently and can be edited in `scripts/git-newworktree.ps1`.

### Subagents and workers

- The top-level session's checkout is the default write boundary. Point subagents at that same worktree with an explicit `cwd`; they must not silently edit the main checkout.
- Parallel read-only workers may share a checkout. Keep one writer at a time within one checkout.
- Do not create one worktree per worker by default. Normally the user obtains real parallel writes through separate top-level Pi sessions and session-level worktrees.
- Use subagent `worktree: true` only when the current session deliberately owns a separate parallel-writer workflow with disjoint ownership and a planned serial integration step. Workers do not perform Git lifecycle operations; the parent session reviews and integrates their results.

## Validation commands

The MCP CLI automatically starts a quiet daemon scoped to the absolute mod-content path. Each worktree therefore has an isolated in-memory index. Filesystem changes trigger one full reindex after a debounce interval, and an idle daemon exits automatically; use `--stop-daemon` only for troubleshooting. Prefer several normal CLI calls over shell loops that pass `--no-daemon`. File arguments may be relative to mod content (preferred), absolute paths inside mod content, or existing paths relative to the caller's current working directory.

Choose checks that match the change:

```powershell
rtk node scripts/hoi4-mcp-cli.js script_validate_file --file "common/national_focus/SOV.txt"
rtk node scripts/hoi4-mcp-cli.js script_get_references --name "SOV_identifier"
rtk node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true
```

Report commands run, results, and any in-game checks still required.
