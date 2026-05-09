#!/usr/bin/env python3
"""Report local ComfyUI assets relevant to focus icon generation."""

from __future__ import annotations

import importlib.util
from pathlib import Path


COMFYUI_ROOT = Path.home() / "ComfyUI"
MODEL_DIRS = {
    "checkpoints": COMFYUI_ROOT / "models" / "checkpoints",
    "loras": COMFYUI_ROOT / "models" / "loras",
    "vae": COMFYUI_ROOT / "models" / "vae",
}


def model_files(path: Path) -> list[Path]:
    if not path.exists():
        return []
    suffixes = {".safetensors", ".ckpt", ".pt", ".pth"}
    return sorted(p for p in path.rglob("*") if p.is_file() and p.suffix.lower() in suffixes)


def main() -> int:
    print("ComfyUI focus icon stack audit")
    print(f"ComfyUI root: {COMFYUI_ROOT}")
    print(f"ComfyUI exists: {COMFYUI_ROOT.exists()}")
    print(f"rembg python package: {importlib.util.find_spec('rembg') is not None}")
    print()

    for label, path in MODEL_DIRS.items():
        files = model_files(path)
        print(f"{label}: {len(files)} file(s)")
        for p in files[:30]:
            print(f"  - {p.relative_to(path)}")
        if len(files) > 30:
            print(f"  ... {len(files) - 30} more")
        print()

    checkpoints = [p.name.lower() for p in model_files(MODEL_DIRS["checkpoints"])]
    loras = [p.name.lower() for p in model_files(MODEL_DIRS["loras"])]
    has_sdxl = any("sdxl" in name or "xl" in name for name in checkpoints)
    has_flux = any("flux" in name for name in checkpoints)
    has_icon_lora = any("icon" in name or "ui" in name for name in loras)

    print("readiness:")
    print(f"  SDXL checkpoint present: {has_sdxl}")
    print(f"  FLUX checkpoint present: {has_flux}")
    print(f"  icon/UI LoRA present: {has_icon_lora}")
    print()

    if not has_sdxl:
        print("next: add an SDXL checkpoint before production icon regeneration")
    if not has_icon_lora:
        print("next: add a game-icon/UI-icon LoRA before production icon regeneration")
    if importlib.util.find_spec("rembg") is None:
        print("next: install rembg or add a LayerDiffuse/background-removal ComfyUI workflow")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
