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
4. Use `scripts/hoi4-mcp-cli.js` for script, reference, scope, mod-structure, and localization operations.
5. Keep effects, visible tooltips, idea variants, and English/Russian localization synchronized.
6. Validate the changed files and references before reporting completion.

The local documentation corpus is under `docs/rag/corpus/`. `docs_search` combines exact grep-style matching, BM25, and optional semantic RAG; use it instead of automatic context injection or codebase-memory.

## Project-specific constraints

- Local vanilla files are authoritative when examples or external documentation conflict.
- Multiplayer determinism and performance take priority over decorative complexity.
- Do not introduce random or hidden rewards without an accurate visible tooltip.
- Do not run destructive commands or Git lifecycle operations without explicit user approval.
- Run `python scripts/hoi4-smoke-windows.py` only when the user explicitly requests the Windows smoke test.
- Prefix shell commands with `rtk`.

## Validation commands

Choose checks that match the change:

```powershell
rtk node scripts/hoi4-mcp-cli.js script_validate_file --file "common/national_focus/SOV.txt"
rtk node scripts/hoi4-mcp-cli.js script_get_references --name "SOV_identifier"
rtk node scripts/hoi4-mcp-cli.js loc_validate --check_missing_refs true --check_languages true
```

Report commands run, results, and any in-game checks still required.
