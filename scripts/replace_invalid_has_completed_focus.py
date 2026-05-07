#!/usr/bin/env python3
"""Replace invalid has_completed_focus trigger entries reported by HOI4 logs.

The smoke log reports paths relative to the shipped mod root, for example:
  common/decisions/GER.txt:123: has_completed_focus

This script uses those exact coordinates and rewrites only the reported
`has_completed_focus = ID` expression to `always = no`.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


LOG_COORD_RE = re.compile(r"\(([^:()]+\.txt):(\d+): has_completed_focus\)")
FOCUS_TRIGGER_RE = re.compile(r"has_completed_focus\s*=\s*[A-Za-z0-9_:.?-]+")
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
    return parser.parse_args()


def log_coordinates(error_log: Path) -> dict[str, set[int]]:
    coordinates: dict[str, set[int]] = {}
    for line in error_log.read_text(encoding="utf-8", errors="replace").splitlines():
        if "Invalid focus scripted in trigger. has_completed_focus" not in line:
            continue
        match = LOG_COORD_RE.search(line)
        if not match:
            continue
        path, line_number = match.groups()
        coordinates.setdefault(path, set()).add(int(line_number))
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


def main() -> int:
    args = parse_args()
    coordinates = log_coordinates(args.error_log)

    changed_files = 0
    changed_lines = 0
    missing_files: list[str] = []
    missed_lines: list[str] = []

    for relative_path, line_numbers in sorted(coordinates.items()):
        file_path = args.mod_root / relative_path
        if not file_path.exists():
            missing_files.append(relative_path)
            continue

        lines, newline, has_bom = read_preserving_style(file_path)
        file_changed = False

        for line_number in sorted(line_numbers):
            index = line_number - 1
            if index < 0 or index >= len(lines):
                missed_lines.append(f"{relative_path}:{line_number}: out of range")
                continue

            line = lines[index]
            new_line, replacements = FOCUS_TRIGGER_RE.subn("always = no", line)
            if replacements == 0:
                if "always = no" not in line:
                    missed_lines.append(f"{relative_path}:{line_number}: {line.rstrip()}")
                continue
            if new_line != line:
                lines[index] = new_line
                file_changed = True
                changed_lines += 1

        if file_changed:
            changed_files += 1
            if not args.dry_run:
                write_preserving_style(file_path, lines, newline, has_bom)

    print(f"reported files: {len(coordinates)}")
    print(f"changed files: {changed_files}")
    print(f"changed lines: {changed_lines}")
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
