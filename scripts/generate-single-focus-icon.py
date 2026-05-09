#!/usr/bin/env python3
"""
Generate a single custom focus icon and register it in custom_focus_icons.gfx.

Usage:
    python3 scripts/generate-single-focus-icon.py --sprite-name GFX_focus_custom_MY_FOCUS --desc "description of the icon"

The script:
  1. Generates an image via ComfyUI (Z-Image GGUF)
  2. Removes background with rembg
  3. Crops transparent margins at full resolution
  4. Fills internal alpha holes
  5. Downsizes to 100x88 and converts to DDS
  6. Appends a SpriteType entry to custom_focus_icons.gfx
"""

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import deque
from pathlib import Path

from PIL import Image


COMFYUI_URL = "http://127.0.0.1:8188"
MOD_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = MOD_ROOT / "BigLeninHistMod" / "gfx" / "interface" / "goals"
OUTPUT_GFX = MOD_ROOT / "BigLeninHistMod" / "interface" / "custom_focus_icons.gfx"
TEMP_DIR = Path("/tmp/zimage-single-icon")

HOI4_ICON_WIDTH = 100
HOI4_ICON_HEIGHT = 88

NEGATIVE_PROMPT = (
    "text, letters, numbers, readable inscriptions, logo, watermark, "
    "modern weapons, modern uniforms, neon colors, anime, cartoon, "
    "flat vector art, clean minimal UI, white background, photograph, "
    "blurry, low detail, bad anatomy, cropped central object, messy composition, "
    "unreadable silhouette, oversized background, duplicate symbols, "
    "excessive realism, 3D render look"
)


def make_prompt(desc: str) -> str:
    return (
        f"Create a square national focus icon in the style of a dark World War II "
        f"grand strategy game. {desc}. "
        f"The icon should look like a dark military heraldic medal: central symbol "
        f"inside a heavy bronze and steel medallion, decorated with laurel branches, "
        f"worn metal, red enamel, and subtle industrial details. "
        f"Style: realistic illustrated game icon, 1930s–1940s wartime aesthetic, "
        f"dark bronze, steel, muted gold, red enamel, patina, scratched metal, "
        f"dramatic lighting, high contrast, dense shadows. "
        f"Composition: symmetrical emblem, central object large and readable at small size, "
        f"decorative frame with laurels, dark nearly black background, slight grain, "
        f"old military decoration feeling. No text, no letters, no numbers, no UI, no caption. "
        f"IMPORTANT: background must be perfectly flat, uniform, solid dark grey "
        f"with no gradients, no textures, no patterns, no vignetting, no edge darkening."
    )


def build_zimage_workflow(
    prompt: str,
    negative_prompt: str,
    width: int,
    height: int,
    steps: int,
    cfg: float,
    seed: int,
    unet_name: str,
    clip_name: str,
    vae_name: str,
) -> dict:
    return {
        "67": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["62", 0]},
        },
        "63": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": vae_name},
        },
        "62": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": clip_name, "type": "lumina2", "device": "default"},
        },
        "65": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["69", 0], "vae": ["63", 0]},
        },
        "70": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"shift": 3, "model": ["94", 0]},
        },
        "71": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative_prompt, "clip": ["62", 0]},
        },
        "69": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "control_after_generate": "randomize",
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "res_multistep",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["70", 0],
                "positive": ["67", 0],
                "negative": ["71", 0],
                "latent_image": ["68", 0],
            },
        },
        "68": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "94": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {"unet_name": unet_name},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "zimage-single", "images": ["65", 0]},
        },
    }


def comfyui_is_running() -> bool:
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats", method="GET")
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def comfyui_queue_prompt(workflow: dict) -> str | None:
    print("  [COMFYUI] Queuing prompt...")
    payload = json.dumps({"prompt": workflow, "client_id": str(uuid.uuid4())}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            pid = result.get("prompt_id")
            print(f"  [COMFYUI] Queued, prompt_id={pid[:16]}...")
            return pid
    except Exception as e:
        print(f"  [COMFYUI] Queue failed: {e}")
        return None


def comfyui_wait_result(prompt_id: str, timeout: int = 600) -> list[str] | None:
    print(f"  [COMFYUI] Waiting for result (timeout={timeout}s)...")
    start = time.time()
    last_print = start
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                history = json.loads(resp.read())
                if prompt_id in history:
                    outputs = history[prompt_id].get("outputs", {})
                    for node_output in outputs.values():
                        if "images" in node_output:
                            fnames = [img["filename"] for img in node_output["images"]]
                            elapsed = time.time() - start
                            print(f"  [COMFYUI] Done in {elapsed:.0f}s")
                            return fnames
        except Exception:
            pass
        now = time.time()
        if now - last_print > 15:
            print(f"  [COMFYUI] Still waiting... {now - start:.0f}s elapsed")
            last_print = now
        time.sleep(2)
    print(f"  [COMFYUI] TIMEOUT after {timeout}s")
    return None


def comfyui_download_image(filename: str, save_path: Path) -> bool:
    print(f"  [DOWNLOAD] Fetching {filename}...")
    try:
        url = f"{COMFYUI_URL}/view?filename={urllib.request.quote(filename)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            save_path.write_bytes(data)
            print(f"  [DOWNLOAD] Saved {len(data)} bytes")
        return True
    except Exception as e:
        print(f"  [DOWNLOAD] Failed: {e}")
        return False


def remove_background_rembg(src_path: Path, dst_path: Path) -> bool:
    print(f"  [REMBG] Removing background...")
    try:
        from rembg import remove
    except Exception:
        print(f"  [REMBG] rembg not installed")
        return False
    try:
        img = Image.open(src_path).convert("RGBA")
        out = remove(img)
        out.save(dst_path)
        print(f"  [REMBG] Done")
        return True
    except Exception as e:
        print(f"  [REMBG] Failed: {e}")
        return False


def crop_transparent_margins(src_path: Path, dst_path: Path, padding: int = 4) -> bool:
    print(f"  [CROP] Cropping transparent margins...")
    try:
        img = Image.open(src_path).convert("RGBA")
        w, h = img.size
        alpha = img.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            print(f"  [CROP] Entire image transparent, skipping")
            img.save(dst_path)
            return True
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - padding)
        y0 = max(0, y0 - padding)
        x1 = min(w, x1 + padding)
        y1 = min(h, y1 + padding)
        cropped = img.crop((x0, y0, x1, y1))
        cropped.save(dst_path)
        print(f"  [CROP] {w}x{h} -> {cropped.size[0]}x{cropped.size[1]}")
        return True
    except Exception as e:
        print(f"  [CROP] Failed: {e}")
        return False


def fill_internal_alpha_holes(src_path: Path, dst_path: Path) -> bool:
    print(f"  [ALPHA] Filling internal holes...")
    try:
        img = Image.open(src_path).convert("RGBA")
        w, h = img.size
        pix = img.load()
        queue = deque()
        edge_transparent = set()

        def is_transparent(x, y):
            return pix[x, y][3] < 128

        for x in range(w):
            for y in (0, h - 1):
                if is_transparent(x, y):
                    queue.append((x, y))
                    edge_transparent.add((x, y))
        for y in range(h):
            for x in (0, w - 1):
                if is_transparent(x, y) and (x, y) not in edge_transparent:
                    queue.append((x, y))
                    edge_transparent.add((x, y))

        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in edge_transparent and is_transparent(nx, ny):
                    edge_transparent.add((nx, ny))
                    queue.append((nx, ny))

        for y in range(h):
            for x in range(w):
                r, g, b, a = pix[x, y]
                if (x, y) in edge_transparent:
                    pix[x, y] = (r, g, b, 0)
                elif a < 255:
                    pix[x, y] = (r, g, b, 255)

        img.save(dst_path)
        print(f"  [ALPHA] Done")
        return True
    except Exception as e:
        print(f"  [ALPHA] Failed: {e}")
        return False


def png_to_dds(png_path: Path, dds_path: Path) -> bool:
    print(f"  [DDS] Converting to {HOI4_ICON_WIDTH}x{HOI4_ICON_HEIGHT} DDS...")
    try:
        result = subprocess.run(
            [
                "magick",
                str(png_path),
                "-resize", f"{HOI4_ICON_WIDTH}x{HOI4_ICON_HEIGHT}!",
                "-type", "TrueColorAlpha",
                "-define", "dds:compression=none",
                str(dds_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            size = dds_path.stat().st_size if dds_path.exists() else 0
            print(f"  [DDS] Done, {size} bytes")
            return True
        print(f"  [DDS] Error: {result.stderr.strip()}")
        return False
    except Exception as e:
        print(f"  [DDS] Failed: {e}")
        return False


def append_gfx_entry(sprite_name: str, texture_file: str, output_path: Path):
    """Append a single SpriteType entry to the .gfx file."""
    entry = f"""
    SpriteType = {{
        name = "{sprite_name}"
        texturefile = "{texture_file}"
    }}
"""
    if output_path.exists():
        content = output_path.read_text(encoding="utf-8")
        # Insert before the closing brace
        if content.rstrip().endswith("}"):
            content = content.rstrip()[:-1] + entry + "\n}\n"
        else:
            content += entry
    else:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        content = f"spriteTypes = {{{entry}\n}}\n"
    output_path.write_text(content, encoding="utf-8")
    print(f"  [GFX] Appended entry to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate a single focus icon")
    parser.add_argument("--sprite-name", required=True, help="GFX sprite name, e.g. GFX_focus_custom_MY_FOCUS")
    parser.add_argument("--desc", required=True, help="Description of the central image/object")
    parser.add_argument("--seed", type=int, default=0, help="Random seed (0=random)")
    parser.add_argument("--steps", type=int, default=35, help="Sampler steps")
    parser.add_argument("--cfg", type=float, default=4.0, help="CFG scale")
    parser.add_argument("--ai-size", type=int, default=512, help="Generation size")
    parser.add_argument("--unet", type=str, default="z-image-Q8_0.gguf")
    parser.add_argument("--clip", type=str, default="qwen_3_4b.safetensors")
    parser.add_argument("--vae", type=str, default="ae.safetensors")
    parser.add_argument("--negative-prompt", type=str, default="")
    parser.add_argument("--force", action="store_true", help="Regenerate if DDS exists")
    args = parser.parse_args()

    # Derive DDS filename from sprite name
    # GFX_focus_custom_XYZ -> focus_custom_XYZ.dds
    match = re.match(r"GFX_focus_custom_(.+)", args.sprite_name)
    if not match:
        print(f"[ERROR] Sprite name must start with GFX_focus_custom_")
        sys.exit(1)
    focus_id = match.group(1)
    dds_filename = f"focus_custom_{focus_id}.dds"
    output_dds = OUTPUT_DIR / dds_filename

    print("=" * 60)
    print(f"Single Focus Icon Generator")
    print(f"  Sprite: {args.sprite_name}")
    print(f"  DDS:    {dds_filename}")
    print("=" * 60)

    existed_before = output_dds.exists()
    if existed_before and not args.force:
        print(f"  [SKIP] Already exists ({output_dds.stat().st_size} bytes)")
        return

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    neg_prompt = args.negative_prompt or NEGATIVE_PROMPT
    prompt = make_prompt(args.desc)
    print(f"\n  [PROMPT] {prompt[:80]}...")

    # Check ComfyUI
    print(f"\n  [CHECK] ComfyUI at {COMFYUI_URL}...")
    if not comfyui_is_running():
        print(f"  [ERROR] ComfyUI not running!")
        sys.exit(1)

    # Build workflow
    workflow = build_zimage_workflow(
        prompt=prompt,
        negative_prompt=neg_prompt,
        width=args.ai_size,
        height=args.ai_size,
        steps=args.steps,
        cfg=args.cfg,
        seed=args.seed if args.seed else int(time.time() * 1000) % (2**32),
        unet_name=args.unet,
        clip_name=args.clip,
        vae_name=args.vae,
    )

    # Generate
    prompt_id = comfyui_queue_prompt(workflow)
    if not prompt_id:
        sys.exit(1)

    images = comfyui_wait_result(prompt_id, timeout=600)
    if not images:
        sys.exit(1)

    temp_output = TEMP_DIR / "single_output.png"
    if not comfyui_download_image(images[0], temp_output):
        sys.exit(1)

    # Process pipeline
    temp_rembg = TEMP_DIR / "single_rembg.png"
    temp_cropped = TEMP_DIR / "single_cropped.png"
    temp_filled = TEMP_DIR / "single_filled.png"

    png_current = temp_output
    if remove_background_rembg(temp_output, temp_rembg):
        png_current = temp_rembg

    if crop_transparent_margins(png_current, temp_cropped):
        png_current = temp_cropped

    if fill_internal_alpha_holes(png_current, temp_filled):
        png_current = temp_filled

    if not png_to_dds(png_current, output_dds):
        sys.exit(1)

    # Register in .gfx (skip only if regenerating an existing icon)
    if not existed_before:
        texture_path = f"gfx/interface/goals/{dds_filename}"
        append_gfx_entry(args.sprite_name, texture_path, OUTPUT_GFX)

    print(f"\n{'=' * 60}")
    print(f"Done! Icon saved to {output_dds}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
