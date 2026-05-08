#!/usr/bin/env python3
"""
Apply alpha channel from vanilla DDS to generated custom focus icons.
No ComfyUI needed — just ImageMagick.

Usage:
    python3 scripts/apply-alpha-to-icons.py [--dry-run]
"""

import argparse
import subprocess
import sys
from pathlib import Path

MOD_ROOT = Path(__file__).parent.parent
VANILLA_GOALS = MOD_ROOT / "vanilla" / "gfx" / "interface" / "goals"
GENERATED_DIR = MOD_ROOT / "BigLeninHistMod" / "gfx" / "interface" / "goals"
TEMP_DIR = Path("/tmp/alpha-apply")


def extract_alpha(dds: Path, out: Path) -> bool:
    r = subprocess.run(
        ["magick", str(dds), "-alpha", "extract", str(out)],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode == 0


def apply_alpha(src: Path, alpha: Path, dst: Path) -> bool:
    r = subprocess.run(
        ["magick", str(src), str(alpha), "-alpha", "off",
         "-compose", "copy_opacity", "-composite", str(dst)],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode == 0


def dds_to_png(dds: Path, png: Path) -> bool:
    r = subprocess.run(
        ["magick", str(dds), str(png)],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode == 0


def png_to_dds(png: Path, dds: Path) -> bool:
    r = subprocess.run(
        ["magick", str(png), "-resize", "100x88!",
         "-type", "TrueColorAlpha",
         "-define", "dds:compression=none", str(dds)],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    generated = sorted(GENERATED_DIR.glob("*.dds"))
    if not generated:
        print("No generated DDS files found.")
        sys.exit(1)

    print(f"Found {len(generated)} generated icons")
    ok = 0
    skipped = 0
    failed = 0

    for gen_dds in generated:
        vanilla_dds = VANILLA_GOALS / gen_dds.name
        if not vanilla_dds.exists():
            print(f"  [SKIP] No vanilla original: {gen_dds.name}")
            skipped += 1
            continue

        alpha_png = TEMP_DIR / f"{gen_dds.stem}_alpha.png"
        src_png = TEMP_DIR / f"{gen_dds.stem}_src.png"
        out_png = TEMP_DIR / f"{gen_dds.stem}_out.png"

        if not extract_alpha(vanilla_dds, alpha_png):
            print(f"  [FAIL] Extract alpha: {gen_dds.name}")
            failed += 1
            continue

        if not dds_to_png(gen_dds, src_png):
            print(f"  [FAIL] DDS→PNG: {gen_dds.name}")
            failed += 1
            continue

        if not apply_alpha(src_png, alpha_png, out_png):
            print(f"  [FAIL] Apply alpha: {gen_dds.name}")
            failed += 1
            continue

        if args.dry_run:
            print(f"  [DRY-RUN] Would update: {gen_dds.name}")
            ok += 1
            continue

        if not png_to_dds(out_png, gen_dds):
            print(f"  [FAIL] PNG→DDS: {gen_dds.name}")
            failed += 1
            continue

        print(f"  [OK] {gen_dds.name}")
        ok += 1

    print(f"\nDone! Applied: {ok}, Skipped: {skipped}, Failed: {failed}")


if __name__ == "__main__":
    main()
