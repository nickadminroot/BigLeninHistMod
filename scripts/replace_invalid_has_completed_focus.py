#!/usr/bin/env python3
"""Replace invalid trigger entries reported by HOI4 logs.

The smoke log reports paths relative to the shipped mod root, for example:
  common/decisions/GER.txt:123: has_completed_focus

This script uses those exact coordinates and rewrites only the reported
trigger expression to `always = no`.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


VALIDATE_RE = re.compile(
    r"Trigger failed to validate: ([^:]+):(\d+): ([A-Za-z0-9_]+)"
)
UTF8_BOM = b"\xef\xbb\xbf"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("error_log", type=Path)
    parser.add_argument(
        "--mod-root",
        type=Path,
        default=Path("BigLeninHistMod"),
        help="Shipped mod root. Defaults to ./BigLeninHistMod.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned replacements without writing files.",
    )
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="Exit successfully when reported files are not present in the mod root.",
    )
    parser.add_argument(
        "--copy-missing-from",
        type=Path,
        help="Copy missing reported files from this source root before patching.",
    )
    return parser.parse_args()


def log_coordinates(error_log: Path) -> dict[str, dict[int, set[str]]]:
    coordinates: dict[str, dict[int, set[str]]] = {}
    for line in error_log.read_text(encoding="utf-8", errors="replace").splitlines():
        match = VALIDATE_RE.search(line)
        if not match:
            continue
        path, line_number, trigger = match.groups()
        coordinates.setdefault(path, {}).setdefault(int(line_number), set()).add(trigger)
    return coordinates


def read_preserving_style(path: Path) -> tuple[list[str], str, bool]:
    data = path.read_bytes()
    has_bom = data.startswith(UTF8_BOM)
    if has_bom:
        data = data[len(UTF8_BOM) :]
    newline = "\r\n" if b"\r\n" in data else "\n"
    text = data.decode("utf-8", errors="replace")
    return text.splitlines(keepends=True), newline, has_bom


def write_preserving_style(
    path: Path, lines: list[str], newline: str, has_bom: bool
) -> None:
    text = "".join(lines)
    if newline == "\r\n":
        text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    else:
        text = text.replace("\r\n", "\n")
    data = text.encode("utf-8")
    if has_bom:
        data = UTF8_BOM + data
    path.write_bytes(data)


def find_block_end(lines: list[str], start_index: int, start_column: int) -> tuple[int, int] | None:
    depth = 0
    saw_open = False
    for index in range(start_index, len(lines)):
        column = start_column if index == start_index else 0
        line = lines[index]
        while column < len(line):
            char = line[column]
            if char == "#":
                break
            if char == "{":
                depth += 1
                saw_open = True
            elif char == "}":
                depth -= 1
                if saw_open and depth == 0:
                    return index, column + 1
            column += 1
    return None


def replace_trigger_at_line(
    lines: list[str], line_number: int, trigger: str
) -> tuple[bool, str | None]:
    index = line_number - 1
    if index < 0 or index >= len(lines):
        return False, "out of range"

    line = lines[index]
    trigger_match = re.search(rf"\b{re.escape(trigger)}\b", line)
    if not trigger_match:
        if "always = no" in line:
            return False, None
        return False, line.rstrip()

    start = trigger_match.start()
    after_name = line[trigger_match.end() :]
    assignment_match = re.match(r"\s*(?:=|<|>|<=|>=)\s*", after_name)
    if not assignment_match:
        return False, line.rstrip()

    value_start = trigger_match.end() + assignment_match.end()
    value_tail = line[value_start:]

    if value_tail.lstrip().startswith("{"):
        block_end = find_block_end(lines, index, value_start)
        if block_end is None:
            return False, f"unterminated block: {line.rstrip()}"
        end_index, end_column = block_end
        suffix = lines[end_index][end_column:]
        lines[index : end_index + 1] = [line[:start] + "always = no" + suffix]
        return True, None

    simple_re = re.compile(
        rf"\b{re.escape(trigger)}\b\s*(?:=|<|>|<=|>=)\s*[^#}}\r\n]+"
    )
    new_line, replacements = simple_re.subn("always = no", line, count=1)
    if replacements == 0:
        return False, line.rstrip()
    if new_line == line:
        return False, None
    lines[index] = new_line
    return True, None


def ensure_file(
    relative_path: str,
    mod_root: Path,
    copy_missing_from: Path | None,
    dry_run: bool,
) -> Path | None:
    file_path = mod_root / relative_path
    if file_path.exists():
        return file_path
    if copy_missing_from is None:
        return None

    source_path = copy_missing_from / relative_path
    if not source_path.exists():
        candidates = sorted(copy_missing_from.rglob(relative_path))
        integrated_candidates = [
            candidate for candidate in candidates if "integrated_dlc" in candidate.parts
        ]
        if len(integrated_candidates) == 1:
            candidates = integrated_candidates
        if len(candidates) == 1:
            source_path = candidates[0]
    if not source_path.exists():
        return None
    if not dry_run:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(source_path.read_bytes())
        return file_path
    return source_path


def main() -> int:
    args = parse_args()
    coordinates = log_coordinates(args.error_log)

    changed_files = 0
    changed_lines = 0
    missing_files: list[str] = []
    missed_lines: list[str] = []

    changed_by_trigger: dict[str, int] = {}

    for relative_path, line_triggers in sorted(coordinates.items()):
        file_path = args.mod_root / relative_path
        read_path = ensure_file(relative_path, args.mod_root, args.copy_missing_from, args.dry_run)
        if read_path is None:
            missing_files.append(relative_path)
            continue

        lines, newline, has_bom = read_preserving_style(read_path)
        file_changed = False

        for line_number, triggers in sorted(line_triggers.items(), reverse=True):
            for trigger in sorted(triggers):
                changed, miss = replace_trigger_at_line(lines, line_number, trigger)
                if miss:
                    missed_lines.append(f"{relative_path}:{line_number}: {trigger}: {miss}")
                if changed:
                    file_changed = True
                    changed_lines += 1
                    changed_by_trigger[trigger] = changed_by_trigger.get(trigger, 0) + 1

        if file_changed:
            changed_files += 1
            if not args.dry_run:
                write_preserving_style(file_path, lines, newline, has_bom)

    print(f"reported files: {len(coordinates)}")
    print(f"changed files: {changed_files}")
    print(f"changed lines: {changed_lines}")
    if changed_by_trigger:
        print("changed by trigger:")
        for trigger, count in sorted(changed_by_trigger.items(), key=lambda item: (-item[1], item[0])):
            print(f"  {trigger}: {count}")
    if missing_files:
        print(f"missing files: {len(missing_files)}")
        for path in missing_files[:20]:
            print(f"  {path}")
    if missed_lines:
        print(f"missed lines: {len(missed_lines)}")
        for line in missed_lines[:40]:
            print(f"  {line}")

    if missed_lines:
        return 1
    if missing_files and not args.allow_missing:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
