#!/usr/bin/env python3
"""
Universal merge vanilla HOI4 files into mod directory for replace_path entries.
Works on Windows, Linux, and macOS.

Usage:
    python merge-vanilla.py [--dry-run]

Environment variables (all optional — auto-detected):
    HOI4_DIR  - Path to HOI4 installation
    MOD_DIR   - Path to mod directory (default: current directory)
"""
from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from hoi4_detect import find_hoi4_dir


def die(message: str) -> None:
    print(f"merge-vanilla: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_replace_paths(descriptor: Path) -> list[str]:
    """Extract replace_path directives from descriptor.mod."""
    content = descriptor.read_text(errors="replace")
    return re.findall(r'replace_path\s*=\s*"([^"]+)"', content)


def find_vanilla_dir(hoi4_dir: Path, replace_path: str) -> Path | None:
    """Find the vanilla directory corresponding to a replace_path."""
    candidate = hoi4_dir / replace_path
    if candidate.is_dir():
        return candidate

    if not replace_path.startswith("common/"):
        candidate = hoi4_dir / "common" / replace_path
        if candidate.is_dir():
            return candidate

    return None


def copy_vanilla_files(vanilla_dir: Path, mod_target: Path, dry_run: bool = False) -> int:
    """Recursively copy vanilla files to mod directory, creating backups."""
    count = 0
    for vanilla_file in vanilla_dir.rglob("*"):
        if not vanilla_file.is_file():
            continue

        rel_path = vanilla_file.relative_to(vanilla_dir)
        target = mod_target / rel_path

        if target.exists():
            backup = target.with_suffix(target.suffix + ".bak")
            if not dry_run:
                if not backup.exists():
                    shutil.copy2(target, backup)
            print(f"  backup: {target} -> {backup}")
        else:
            if not dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)

        if not dry_run:
            shutil.copy2(vanilla_file, target)
        print(f"  copy: {vanilla_file} -> {target}")
        count += 1

    return count


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    hoi4_dir = find_hoi4_dir()
    if hoi4_dir is None:
        die(
            "Could not find Hearts of Iron IV installation.\n"
            "Set HOI4_DIR environment variable to your HOI4 install path.\n"
            "Example: export HOI4_DIR=\"/path/to/Hearts of Iron IV\"\n"
            "Windows: set HOI4_DIR=G:\\SteamLibrary\\steamapps\\common\\Hearts of Iron IV"
        )

    mod_dir = Path(os.environ.get("MOD_DIR", ".")).resolve()
    descriptor = mod_dir / "descriptor.mod"
    if not descriptor.is_file():
        # Search in subdirectories (common repo structure: repo/mod_name/descriptor.mod)
        for candidate in mod_dir.glob("*/descriptor.mod"):
            if candidate.is_file():
                descriptor = candidate
                mod_dir = candidate.parent
                break
    if not descriptor.is_file():
        die(f"descriptor.mod not found in {mod_dir} or its subdirectories")

    replace_paths = parse_replace_paths(descriptor)
    if not replace_paths:
        print("No replace_path directives found in descriptor.mod")
        return 0

    print(f"HOI4 dir: {hoi4_dir}")
    print(f"Mod dir:  {mod_dir}")
    print(f"Found {len(replace_paths)} replace_path directives")
    if dry_run:
        print("DRY RUN — no files will be modified")
    print()

    total = 0
    for rp in replace_paths:
        vanilla_dir = find_vanilla_dir(hoi4_dir, rp)
        if vanilla_dir is None:
            print(f"  SKIP: {rp} (vanilla directory not found)")
            continue

        mod_target = mod_dir / rp
        print(f"  Processing: {rp}")
        print(f"    Vanilla: {vanilla_dir}")
        print(f"    Target:  {mod_target}")

        count = copy_vanilla_files(vanilla_dir, mod_target, dry_run)
        total += count
        print(f"    Copied: {count} files")
        print()

    print(f"Total files copied: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
