#!/usr/bin/env python3
"""Create disjoint workspaces for parallel weak-agent vanilla delta integration."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batches", type=int, default=20)
    parser.add_argument("--status", default="AGENT_SMALL", help="Manifest status to assign")
    parser.add_argument("--path-list", type=Path, help="Optional UTF-8 file containing one selected mod-relative path per line")
    parser.add_argument("--exclude-prefix", action="append", default=[], help="Exclude mod-relative path prefix; repeatable")
    parser.add_argument("--task-note", default="", help="Extra instructions appended to every batch task")
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output = args.output.resolve()
    if output.exists():
        print(f"output already exists: {output}", file=sys.stderr)
        return 1
    if args.batches < 1:
        print("--batches must be positive", file=sys.stderr)
        return 1

    old = Path(manifest["oldVanilla"])
    new = Path(manifest["newVanilla"])
    mod = Path(manifest["mod"])
    source_root = Path(manifest["output"])
    selected_paths = None
    if args.path_list:
        selected_paths = {
            line.strip().replace("\\", "/")
            for line in args.path_list.read_text(encoding="utf-8-sig").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
    entries = [
        entry
        for entry in manifest["entries"]
        if entry["status"] == args.status
        and (selected_paths is None or entry["path"] in selected_paths)
        and not any(entry["path"].startswith(prefix.replace("\\", "/")) for prefix in args.exclude_prefix)
    ]
    if selected_paths is not None:
        found = {entry["path"] for entry in entries}
        missing = sorted(selected_paths - found)
        if missing:
            print(f"selected paths missing or not status {args.status}: {missing}", file=sys.stderr)
            return 1
    if not entries:
        print("no matching manifest entries", file=sys.stderr)
        return 1

    # Greedy balancing by semantic diff size plus per-file overhead.
    buckets: list[list[dict]] = [[] for _ in range(min(args.batches, len(entries)))]
    weights = [0 for _ in buckets]
    for entry in sorted(entries, key=lambda item: item["vanilla_changed_lines"] or 0, reverse=True):
        index = min(range(len(buckets)), key=lambda i: weights[i])
        buckets[index].append(entry)
        weights[index] += (entry["vanilla_changed_lines"] or 0) + 12

    output.mkdir(parents=True)
    batch_records = []
    assigned_paths: set[str] = set()
    for number, bucket in enumerate(buckets, 1):
        batch_id = f"batch-{number:02d}"
        batch_dir = output / batch_id
        assignment_entries = []
        for entry in sorted(bucket, key=lambda item: item["path"].lower()):
            rel = entry["path"]
            if rel in assigned_paths:
                raise RuntimeError(f"duplicate assignment: {rel}")
            assigned_paths.add(rel)
            mod_file = mod / rel
            current = mod_file.read_bytes()
            if sha256(current) != entry["before_sha256"]:
                raise RuntimeError(f"mod file changed after delta scan: {rel}")
            copy_file(mod_file, batch_dir / "inputs" / "mod" / rel)
            copy_file(old / rel, batch_dir / "inputs" / "old" / rel)
            copy_file(new / rel, batch_dir / "inputs" / "new" / rel)
            copy_file(source_root / entry["diff_path"], batch_dir / "inputs" / "diffs" / (rel + ".diff"))
            copy_file(mod_file, batch_dir / "results" / rel)
            assignment_entries.append(
                {
                    "path": rel,
                    "vanillaChangedLines": entry["vanilla_changed_lines"],
                    "originalSha256": entry["before_sha256"],
                    "modInput": f"inputs/mod/{rel}",
                    "oldVanilla": f"inputs/old/{rel}",
                    "newVanilla": f"inputs/new/{rel}",
                    "vanillaDiff": f"inputs/diffs/{rel}.diff",
                    "result": f"results/{rel}",
                }
            )
        assignment = {"batchId": batch_id, "entries": assignment_entries}
        (batch_dir / "assignment.json").write_text(json.dumps(assignment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        paths = "\n".join(f"- `{item['path']}` ({item['vanillaChangedLines']} changed vanilla lines)" for item in assignment_entries)
        task = f"""# Parallel vanilla delta integration — {batch_id}

You own only this isolated workspace. Read `assignment.json` and process every entry.
Do not edit the real mod under `BigLeninHistMod/`; edit only files under `results/`.
The result files start as exact copies of the clean mod files.

For each entry:
1. Read `inputs/diffs/<path>.diff` to understand only OLD→NEW vanilla changes.
2. Compare `inputs/mod/<path>`, `inputs/old/<path>`, and `inputs/new/<path>`.
3. If meaningful and unambiguous, edit `results/<path>` with the analogous semantic change, preserving mod-specific content.
4. Never replace the complete mod file with vanilla.
5. If the corresponding place cannot be found, structure differs too much, or the change has no meaning in the mod, leave `results/<path>` byte-identical and report `SKIP` with the reason.
6. Use docs_search for engine-sensitive identifiers/effects/triggers/modifiers/scopes and verify local references. Cite documentation paths.
7. Do not run Git lifecycle commands. Do not edit files outside this workspace.
8. Do not read or apply the pi-subagents skill; the parent owns orchestration.

Assigned files:
{paths}

Additional batch policy:
{args.task_note or "No additional policy."}

Return a Russian summary with one `APPLY`, `PARTIAL`, or `SKIP` line per assigned path and status `DONE`/`BLOCKED`. For `PARTIAL`, enumerate every applied and skipped vanilla hunk plus the exact dependency/reason.
"""
        (batch_dir / "task.md").write_text(task, encoding="utf-8", newline="\n")
        batch_records.append(
            {
                "batchId": batch_id,
                "cwd": batch_dir.as_posix(),
                "task": (batch_dir / "task.md").as_posix(),
                "files": len(assignment_entries),
                "weight": weights[number - 1],
                "paths": [item["path"] for item in assignment_entries],
            }
        )

    if len(assigned_paths) != len(entries):
        raise RuntimeError(f"assignment mismatch: {len(assigned_paths)} != {len(entries)}")
    workspace_manifest = {
        "sourceManifest": manifest_path.as_posix(),
        "mod": mod.as_posix(),
        "output": output.as_posix(),
        "selectedStatus": args.status,
        "pathList": args.path_list.resolve().as_posix() if args.path_list else None,
        "excludePrefixes": args.exclude_prefix,
        "taskNote": args.task_note,
        "entryCount": len(entries),
        "batchCount": len(batch_records),
        "batches": batch_records,
    }
    (output / "workspace-manifest.json").write_text(
        json.dumps(workspace_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"entries": len(entries), "batches": len(batch_records), "weights": weights}, ensure_ascii=False))
    print(f"Workspace manifest: {output / 'workspace-manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
