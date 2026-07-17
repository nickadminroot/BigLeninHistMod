#!/usr/bin/env python3
"""
Merge vanilla HOI4 files into mod directory for replace_path entries.
Windows version of merge-vanilla.sh

Usage:
    python scripts/merge-vanilla-windows.py [--dry-run]

Environment variables:
    HOI4_DIR  - Path to HOI4 installation (default: G:\\SteamLibrary\\steamapps\\common\\Hearts of Iron IV)
    MOD_DIR   - Path to the mod content directory or repository root (default: current directory)
"""
from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

DEFAULT_HOI4_DIR = r"G:\SteamLibrary\steamapps\common\Hearts of Iron IV"


def die(message: str) -> None:
    print(f"merge-vanilla-windows: {message}", file=sys.stderr)
    raise SystemExit(1)


def env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def parse_replace_paths(descriptor: Path) -> list[str]:
    """Extract replace_path directives from descriptor.mod."""
    content = descriptor.read_text(errors="replace")
    paths = re.findall(r'replace_path\s*=\s*"([^"]+)"', content)
    return paths


def find_vanilla_dir(hoi4_dir: Path, replace_path: str) -> Path | None:
    """Find the vanilla directory corresponding to a replace_path."""
    # Common HOI4 directory structure:
    # replace_path = "common/national_focus" -> hoI4_dir/common/national_focus/
    candidate = hoi4_dir / replace_path
    if candidate.is_dir():
        return candidate

    # Try with common/ prefix if not already present
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
            # Create backup
            backup = target.with_suffix(target.suffix + ".bak")
            if not dry_run:
                if not backup.exists():
                    shutil.copy2(target, backup)
            print(f"  backup: {target} -> {backup}")
        else:
            # Create parent directory
            if not dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)

        if not dry_run:
            shutil.copy2(vanilla_file, target)
        print(f"  copy: {vanilla_file} -> {target}")
        count += 1

    return count


def main() -> int:
    hoi4_dir = Path(env("HOI4_DIR", DEFAULT_HOI4_DIR))
    mod_dir = Path(env("MOD_DIR", ".")).resolve()
    dry_run = "--dry-run" in sys.argv

    descriptor = mod_dir / "descriptor.mod"
    if not descriptor.is_file():
        # Support the documented repository layout: repo/ModName/descriptor.mod.
        descriptors = list(mod_dir.glob("*/descriptor.mod"))
        if len(descriptors) == 1:
            descriptor = descriptors[0]
            mod_dir = descriptor.parent
        elif len(descriptors) > 1:
            die(
                f"multiple descriptor.mod files found under {mod_dir}; "
                "set MOD_DIR to the intended mod content directory"
            )
        else:
            die(f"descriptor.mod not found in {mod_dir} or its immediate subdirectories")

    if not hoi4_dir.is_dir():
        die(f"HOI4 directory not found: {hoi4_dir}")

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
