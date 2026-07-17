#!/usr/bin/env python3
"""Validate parallel agent workspace results and optionally apply them atomically."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import shutil
import tempfile
from collections import Counter
from pathlib import Path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def changed_lines(before: bytes, after: bytes) -> int:
    a = normalize(before).decode("utf-8-sig").splitlines(keepends=True)
    b = normalize(after).decode("utf-8-sig").splitlines(keepends=True)
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=True)
    return sum((i2 - i1) + (j2 - j1) for tag, i1, i2, j1, j2 in matcher.get_opcodes() if tag != "equal")


def write_atomic(path: Path, data: bytes) -> None:
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace_manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--max-result-lines", type=int, default=250)
    parser.add_argument("--max-multiplier", type=int, default=6)
    args = parser.parse_args()

    wm_path = args.workspace_manifest.resolve()
    wm = json.loads(wm_path.read_text(encoding="utf-8"))
    workspace_root = Path(wm["output"])
    mod = Path(wm["mod"])
    records = []

    for batch in wm["batches"]:
        batch_dir = Path(batch["cwd"])
        assignment = json.loads((batch_dir / "assignment.json").read_text(encoding="utf-8"))
        for entry in assignment["entries"]:
            rel = entry["path"]
            original = (batch_dir / entry["modInput"]).read_bytes()
            result_path = batch_dir / entry["result"]
            result = result_path.read_bytes()
            current_path = mod / rel
            current = current_path.read_bytes()
            record = {
                "batchId": batch["batchId"],
                "path": rel,
                "vanillaChangedLines": entry["vanillaChangedLines"],
                "resultChangedLines": 0,
                "status": "SKIP_UNCHANGED",
                "reason": "agent left isolated result unchanged",
                "applied": False,
            }
            if sha256(original) != entry["originalSha256"]:
                record.update(status="REJECT_INPUT_HASH", reason="workspace mod input hash mismatch")
                records.append(record)
                continue
            if sha256(current) != entry["originalSha256"]:
                record.update(status="REJECT_TARGET_CHANGED", reason="real mod target changed after workspace creation")
                records.append(record)
                continue
            if result == original:
                records.append(record)
                continue
            if any(marker in result for marker in (b"<<<<<<< ", b"=======", b">>>>>>> ")):
                record.update(status="REJECT_CONFLICT_MARKERS", reason="agent result contains conflict markers")
                records.append(record)
                continue
            try:
                result_delta = changed_lines(original, result)
            except UnicodeDecodeError as error:
                record.update(status="REJECT_ENCODING", reason=str(error))
                records.append(record)
                continue
            record["resultChangedLines"] = result_delta
            limit = max(args.max_result_lines, entry["vanillaChangedLines"] * args.max_multiplier + 30)
            if result_delta > limit:
                record.update(
                    status="REJECT_TOO_LARGE",
                    reason=f"agent changed {result_delta} lines; safety limit is {limit}",
                )
                records.append(record)
                continue
            new_vanilla = (batch_dir / entry["newVanilla"]).read_bytes()
            if result == new_vanilla and original != new_vanilla:
                record.update(status="REJECT_WHOLESALE_VANILLA", reason="agent result is byte-identical to complete new vanilla file")
                records.append(record)
                continue
            record.update(status="ACCEPT", reason="isolated semantic proposal passed structural guards", applied=args.apply)
            if args.apply:
                write_atomic(current_path, result)
            records.append(record)

    counts = Counter(record["status"] for record in records)
    report = {
        "workspaceManifest": wm_path.as_posix(),
        "mod": mod.as_posix(),
        "apply": args.apply,
        "summary": {"entries": len(records), "statuses": dict(sorted(counts.items()))},
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"Collection report: {args.output.resolve()}")
    return 0 if not any(status.startswith("REJECT") for status in counts) else 2


if __name__ == "__main__":
    raise SystemExit(main())
