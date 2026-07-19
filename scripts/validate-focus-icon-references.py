#!/usr/bin/env python3
"""Validate custom focus icon sprite references."""

from __future__ import annotations

import re
from pathlib import Path


MOD_ROOT = Path(__file__).parent.parent
SHIPPED = MOD_ROOT / "BigLeninHistMod"
NF_DIR = SHIPPED / "common" / "national_focus"
CUSTOM_GFX_FILES = (
    SHIPPED / "interface" / "custom_focus_icons.gfx",
    SHIPPED / "interface" / "deferred_focus_icons.gfx",
)


def parse_custom_sprites() -> dict[str, str]:
    pattern = re.compile(
        r'name\s*=\s*"?(GFX_focus_custom_[^"\s}]+)"?[^}]*?texturefile\s*=\s*"([^"]+)"',
        re.DOTALL,
    )
    sprites: dict[str, str] = {}
    for path in CUSTOM_GFX_FILES:
        if path.exists():
            content = path.read_text(encoding="utf-8", errors="ignore")
            sprites.update({name: texture for name, texture in pattern.findall(content)})
    return sprites


def used_custom_icons() -> dict[str, list[tuple[Path, int]]]:
    used: dict[str, list[tuple[Path, int]]] = {}
    for path in sorted(NF_DIR.glob("*.txt")):
        for line_no, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            match = re.search(r'\bicon\s*=\s*(GFX_focus_custom_[^\s"#]+)', line)
            if match:
                used.setdefault(match.group(1), []).append((path, line_no))
    return used


def main() -> int:
    sprites = parse_custom_sprites()
    used = used_custom_icons()
    failed = 0

    missing_sprites = sorted(set(used) - set(sprites))
    if missing_sprites:
        failed += len(missing_sprites)
        print("Missing sprite definitions:")
        for name in missing_sprites:
            refs = ", ".join(f"{p}:{line}" for p, line in used[name])
            print(f"  {name} used at {refs}")

    missing_textures = []
    for name, texture in sorted(sprites.items()):
        texture_path = SHIPPED / texture
        if not texture_path.exists():
            missing_textures.append((name, texture))

    if missing_textures:
        failed += len(missing_textures)
        print("Missing sprite texture files:")
        for name, texture in missing_textures:
            print(f"  {name} -> {texture}")

    if failed:
        print(f"FAILED: {failed} issue(s)")
        return 1

    print(f"OK: {len(used)} used custom icons, {len(sprites)} sprite definitions, all texture paths exist")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
