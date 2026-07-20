#!/usr/bin/env python3
"""Prepare and optionally apply safe vanilla updates to an HOI4 mod.

Unlike merge_vanilla.bash, this tool never writes conflict markers. For each
file already present in the mod it compares OLD_VANILLA -> NEW_VANILLA:

* clean text 3-way merges may be applied with --apply-clean;
* clean binary fast-forwards are copied only when MOD == OLD_VANILLA;
* text conflicts leave the mod untouched and get a standalone vanilla diff;
* small conflicts are queued for agent-assisted semantic integration;
* large, binary, added/deleted, and error cases are deferred.

The output manifest is intended to drive parallel read-only agents that propose
patches. Proposed patches should be validated and applied sequentially later.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

TEXT_EXTENSIONS = {
    ".asset", ".csv", ".gfx", ".gui", ".json", ".lua", ".map",
    ".md", ".mod", ".settings", ".txt", ".xml", ".yml", ".yaml",
}
BINARY_EXTENSIONS = {
    ".bmp", ".dds", ".dll", ".exe", ".gif", ".jpeg", ".jpg",
    ".ogg", ".png", ".so", ".tga", ".wav", ".zip",
}


@dataclass
class Entry:
    path: str
    status: str
    kind: str
    vanilla_changed_lines: int | None = None
    vanilla_added_lines: int | None = None
    vanilla_deleted_lines: int | None = None
    diff_path: str | None = None
    preview_path: str | None = None
    task_path: str | None = None
    reason: str | None = None
    applied: bool = False
    before_sha256: str | None = None
    after_sha256: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old_vanilla", type=Path)
    parser.add_argument("new_vanilla", type=Path)
    parser.add_argument("mod", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--max-agent-lines",
        type=int,
        default=50,
        help="Maximum added+deleted vanilla lines for AGENT_SMALL (default: 50)",
    )
    parser.add_argument(
        "--apply-clean",
        action="store_true",
        help="Atomically write clean text merges and safe binary fast-forwards",
    )
    parser.add_argument(
        "--overwrite-output",
        action="store_true",
        help="Replace an existing output directory (never touches the mod for cleanup)",
    )
    return parser.parse_args()


def die(message: str) -> None:
    print(f"prepare-vanilla-delta-merge: {message}", file=sys.stderr)
    raise SystemExit(1)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_newlines(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def preferred_newline(data: bytes) -> bytes:
    crlf = data.count(b"\r\n")
    lone_lf = data.count(b"\n") - crlf
    return b"\r\n" if crlf > lone_lf else b"\n"


def restore_newlines(data: bytes, newline: bytes) -> bytes:
    normalized = normalize_newlines(data)
    return normalized if newline == b"\n" else normalized.replace(b"\n", b"\r\n")


def is_probably_text(path: Path, *samples: bytes) -> bool:
    suffix = path.suffix.lower()
    if suffix in BINARY_EXTENSIONS:
        return False
    if suffix in TEXT_EXTENSIONS:
        return True
    for data in samples:
        if b"\0" in data[:8192]:
            return False
        try:
            data[:65536].decode("utf-8-sig")
        except UnicodeDecodeError:
            return False
    return True


def decode_lines(data: bytes) -> list[str]:
    return normalize_newlines(data).decode("utf-8-sig").splitlines(keepends=True)


def line_delta(old_data: bytes, new_data: bytes) -> tuple[int, int, int]:
    old_lines = decode_lines(old_data)
    new_lines = decode_lines(new_data)
    matcher = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=True)
    added = 0
    deleted = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        deleted += i2 - i1
        added += j2 - j1
    return added + deleted, added, deleted


def unified_delta(rel: str, old_data: bytes, new_data: bytes) -> str:
    old_lines = decode_lines(old_data)
    new_lines = decode_lines(new_data)
    return "".join(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{rel} (old vanilla)",
            tofile=f"b/{rel} (new vanilla)",
            n=5,
            lineterm="\n",
        )
    )


def safe_artifact_path(root: Path, rel: str, suffix: str) -> Path:
    target = root.joinpath(*Path(rel).parts)
    return target.with_name(target.name + suffix)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            shutil.copystat(path, temp_name)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def merge_text(mod_data: bytes, old_data: bytes, new_data: bytes) -> tuple[str, bytes, str | None]:
    """Return (status, output, error). Status is CLEAN, CONFLICT, or ERROR."""
    with tempfile.TemporaryDirectory(prefix="hoi4-vanilla-merge-") as raw_dir:
        temp = Path(raw_dir)
        ours = temp / "ours.txt"
        base = temp / "base.txt"
        theirs = temp / "theirs.txt"
        ours.write_bytes(normalize_newlines(mod_data))
        base.write_bytes(normalize_newlines(old_data))
        theirs.write_bytes(normalize_newlines(new_data))
        process = subprocess.run(
            [
                "git", "merge-file", "-p",
                "-L", "MOD",
                "-L", "OLD_VANILLA",
                "-L", "NEW_VANILLA",
                str(ours), str(base), str(theirs),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode == 0:
            return "CLEAN", process.stdout, None
        # git merge-file returns the number of conflicts (capped at 127),
        # not merely 1, when it produced a valid file with conflict markers.
        if 1 <= process.returncode <= 127:
            return "CONFLICT", process.stdout, process.stderr.decode(errors="replace") or None
        return "ERROR", process.stdout, process.stderr.decode(errors="replace") or f"git merge-file exit {process.returncode}"


def parse_replace_paths(descriptor: Path) -> list[str]:
    if not descriptor.is_file():
        return []
    text = descriptor.read_text(encoding="utf-8", errors="replace")
    return sorted(set(re.findall(r'replace_path\s*=\s*"([^"]+)"', text)))


def iter_mod_files(mod: Path, output: Path) -> Iterable[Path]:
    output_resolved = output.resolve()
    for path in mod.rglob("*"):
        if not path.is_file():
            continue
        try:
            path.resolve().relative_to(output_resolved)
        except ValueError:
            yield path


def make_task(rel: str, diff_rel: str, changed_lines: int) -> str:
    return f"""# Vanilla delta integration task

Target: `BigLeninHistMod/{rel}`
Vanilla delta: `{diff_rel}`
Vanilla changed lines: {changed_lines}

Apply an analogous semantic change to the existing mod file, not a wholesale
vanilla replacement. Compare the clean mod file with `vanilla/{rel}` and
`vanilla_new/{rel}`. Use `rtk node scripts/docs-search.mjs --query "<term>" --mode hybrid --limit 5` for engine-sensitive HOI4 identifiers and
verify local references when needed.

If the corresponding location cannot be found unambiguously, the mod structure
is substantially different, or the vanilla change has no meaning in the mod,
do not modify anything: return `SKIP` with a concrete reason.

Expected proposal result (read-only worker):
- `APPLY`: provide a minimal unified diff against `BigLeninHistMod/{rel}`; or
- `SKIP`: explain why the vanilla delta should not/cannot be integrated.

Do not replace the complete file. Do not run Git lifecycle commands. Do not
read or apply the pi-subagents skill; the parent owns orchestration.
"""


def main() -> int:
    args = parse_args()
    old = args.old_vanilla.resolve()
    new = args.new_vanilla.resolve()
    mod = args.mod.resolve()
    output = args.output.resolve()

    for label, path in (("old vanilla", old), ("new vanilla", new), ("mod", mod)):
        if not path.is_dir():
            die(f"{label} directory not found: {path}")
    if args.max_agent_lines < 0:
        die("--max-agent-lines must be non-negative")
    if output.exists():
        if not args.overwrite_output:
            die(f"output already exists: {output}; use --overwrite-output")
        shutil.rmtree(output)
    output.mkdir(parents=True)

    entries: list[Entry] = []
    changed_relpaths: set[str] = set()

    for mod_file in sorted(iter_mod_files(mod, output), key=lambda p: p.as_posix().lower()):
        rel = mod_file.relative_to(mod).as_posix()
        old_file = old / rel
        new_file = new / rel
        old_exists = old_file.is_file()
        new_exists = new_file.is_file()
        if not old_exists and not new_exists:
            continue
        if not old_exists and new_exists:
            entries.append(Entry(rel, "DEFER_VANILLA_ADDED_COLLISION", "unknown", reason="path is new in vanilla but already exists in mod"))
            continue
        if old_exists and not new_exists:
            entries.append(Entry(rel, "DEFER_VANILLA_DELETED", "unknown", reason="path was deleted from new vanilla"))
            continue

        mod_data = mod_file.read_bytes()
        old_data = old_file.read_bytes()
        new_data = new_file.read_bytes()
        text = is_probably_text(Path(rel), mod_data, old_data, new_data)
        if text:
            try:
                unchanged = normalize_newlines(old_data) == normalize_newlines(new_data)
            except Exception:
                unchanged = old_data == new_data
        else:
            unchanged = old_data == new_data
        if unchanged:
            continue
        changed_relpaths.add(rel)

        before_hash = sha256(mod_data)
        if not text:
            if mod_data == old_data:
                entry = Entry(rel, "AUTO_BINARY_FAST_FORWARD", "binary", applied=args.apply_clean, before_sha256=before_hash, after_sha256=sha256(new_data))
                if args.apply_clean:
                    write_bytes_atomic(mod_file, new_data)
            else:
                entry = Entry(rel, "DEFER_BINARY", "binary", reason="binary differs in both mod and vanilla; semantic merge required", before_sha256=before_hash)
            entries.append(entry)
            continue

        try:
            changed, added, deleted = line_delta(old_data, new_data)
            delta_text = unified_delta(rel, old_data, new_data)
        except UnicodeDecodeError as error:
            entries.append(Entry(rel, "DEFER_ENCODING", "text", reason=str(error), before_sha256=before_hash))
            continue

        diff_file = safe_artifact_path(output / "diffs", rel, ".diff")
        write_text(diff_file, delta_text)
        diff_rel = diff_file.relative_to(output).as_posix()

        if normalize_newlines(mod_data) == normalize_newlines(old_data):
            merged = normalize_newlines(new_data)
            output_data = restore_newlines(merged, preferred_newline(mod_data))
            entry = Entry(
                rel, "AUTO_TEXT_FAST_FORWARD", "text", changed, added, deleted,
                diff_rel, applied=args.apply_clean, before_sha256=before_hash,
                after_sha256=sha256(output_data),
            )
            if args.apply_clean:
                write_bytes_atomic(mod_file, output_data)
            entries.append(entry)
            continue

        merge_status, merged, error = merge_text(mod_data, old_data, new_data)
        if merge_status == "CLEAN":
            output_data = restore_newlines(merged, preferred_newline(mod_data))
            entry = Entry(
                rel, "AUTO_TEXT_MERGED", "text", changed, added, deleted,
                diff_rel, applied=args.apply_clean, before_sha256=before_hash,
                after_sha256=sha256(output_data),
            )
            if args.apply_clean:
                write_bytes_atomic(mod_file, output_data)
            entries.append(entry)
            continue

        preview_file = safe_artifact_path(output / "previews", rel, ".merge-preview")
        write_bytes_atomic(preview_file, merged)
        preview_rel = preview_file.relative_to(output).as_posix()
        if merge_status == "CONFLICT" and changed <= args.max_agent_lines:
            task_file = safe_artifact_path(output / "tasks", rel, ".task.md")
            task_rel = task_file.relative_to(output).as_posix()
            write_text(task_file, make_task(rel, diff_rel, changed))
            status = "AGENT_SMALL"
        elif merge_status == "CONFLICT":
            task_rel = None
            status = "DEFER_LARGE"
        else:
            task_rel = None
            status = "DEFER_MERGE_ERROR"
        entries.append(
            Entry(
                rel, status, "text", changed, added, deleted, diff_rel,
                preview_rel, task_rel, error, False, before_hash, None,
            )
        )

    # Report additions/deletions under replace_path without modifying the mod.
    replace_paths = parse_replace_paths(mod / "descriptor.mod")
    old_files = {p.relative_to(old).as_posix() for p in old.rglob("*") if p.is_file()}
    new_files = {p.relative_to(new).as_posix() for p in new.rglob("*") if p.is_file()}
    under_replace = lambda rel: any(rel == rp or rel.startswith(rp.rstrip("/") + "/") for rp in replace_paths)
    added_under_replace = sorted(rel for rel in new_files - old_files if under_replace(rel))
    deleted_under_replace = sorted(rel for rel in old_files - new_files if under_replace(rel))

    counts = Counter(entry.status for entry in entries)
    manifest = {
        "schemaVersion": 1,
        "oldVanilla": old.as_posix(),
        "newVanilla": new.as_posix(),
        "mod": mod.as_posix(),
        "output": output.as_posix(),
        "maxAgentLines": args.max_agent_lines,
        "applyClean": args.apply_clean,
        "summary": {
            "changedModPaths": len(changed_relpaths),
            "entries": len(entries),
            "statuses": dict(sorted(counts.items())),
            "agentSmall": counts["AGENT_SMALL"],
            "deferredLarge": counts["DEFER_LARGE"],
            "addedUnderReplacePath": len(added_under_replace),
            "deletedUnderReplacePath": len(deleted_under_replace),
        },
        "replacePaths": replace_paths,
        "addedUnderReplacePath": added_under_replace,
        "deletedUnderReplacePath": deleted_under_replace,
        "entries": [asdict(entry) for entry in entries],
    }
    write_text(output / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    tsv_lines = [
        "status\tkind\tchanged_lines\tadded\tdeleted\tapplied\tpath\tdiff\ttask\treason\n"
    ]
    for entry in entries:
        values = [
            entry.status,
            entry.kind,
            "" if entry.vanilla_changed_lines is None else str(entry.vanilla_changed_lines),
            "" if entry.vanilla_added_lines is None else str(entry.vanilla_added_lines),
            "" if entry.vanilla_deleted_lines is None else str(entry.vanilla_deleted_lines),
            "yes" if entry.applied else "no",
            entry.path,
            entry.diff_path or "",
            entry.task_path or "",
            (entry.reason or "").replace("\t", " ").replace("\n", " "),
        ]
        tsv_lines.append("\t".join(values) + "\n")
    write_text(output / "manifest.tsv", "".join(tsv_lines))

    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    print(f"Manifest: {output / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
