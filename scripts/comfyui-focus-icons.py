#!/usr/bin/env python3
"""
ComfyUI Focus Icon Pipeline for Hearts of Iron IV

Generates custom focus icons using Stable Diffusion img2img via ComfyUI API.
Converts vanilla DDS icons → PNG → AI transform → PNG → DDS → .gfx registration.

Usage:
    python3 scripts/comfyui-focus-icons.py [OPTIONS]

Prerequisites:
    - ComfyUI running on http://127.0.0.1:8188
    - SD 1.5 checkpoint in ~/ComfyUI/models/checkpoints/
    - ImageMagick (magick) installed
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


COMFYUI_URL = "http://127.0.0.1:8188"
WORKFLOW_PATH = Path(__file__).parent / "comfyui-focus-icon-workflow.json"
MOD_ROOT = Path(__file__).parent.parent
VANILLA_GOALS_GFX = MOD_ROOT / "vanilla" / "interface" / "goals.gfx"
VANILLA_GOALS_DIR = MOD_ROOT / "vanilla" / "gfx" / "interface" / "goals"
OUTPUT_DIR = MOD_ROOT / "BigLeninHistMod" / "gfx" / "interface" / "goals"
OUTPUT_GFX = MOD_ROOT / "BigLeninHistMod" / "interface" / "custom_focus_icons.gfx"
TEMP_DIR = Path("/tmp/comfyui-focus-icons")

HOI4_ICON_WIDTH = 100
HOI4_ICON_HEIGHT = 88
AI_IMAGE_SIZE = 512


FOCUS_PROMPT_MAP = {
    "army": "military army icon, soldiers, weapons, WW2 military, flat game UI icon",
    "navy": "naval fleet icon, warship, anchor, navy, flat game UI icon",
    "air": "airforce icon, airplane, fighter plane, air force, flat game UI icon",
    "industry": "industrial icon, factory, gears, production, flat game UI icon",
    "research": "research icon, science, lightbulb, technology, flat game UI icon",
    "politics": "political icon, government, parliament, politics, flat game UI icon",
    "diplomacy": "diplomacy icon, handshake, treaty, alliance, flat game UI icon",
    "infantry": "infantry icon, rifle, soldier, military ground forces, flat game UI icon",
    "tank": "tank icon, armored vehicle, panzer, military vehicle, flat game UI icon",
    "artillery": "artillery icon, cannon, howitzer, military gun, flat game UI icon",
    "fort": "fortification icon, bunker, fortress, defense, flat game UI icon",
    "oil": "oil resource icon, oil derrick, petroleum, fuel, flat game UI icon",
    "steel": "steel resource icon, metal, iron, ore, flat game UI icon",
    "aluminium": "aluminium resource icon, metal ore, mining, flat game UI icon",
    "rubber": "rubber resource icon, plantation, latex, flat game UI icon",
    "tungsten": "tungsten resource icon, rare metal, mining, flat game UI icon",
    "chromium": "chromium resource icon, chrome ore, mining, flat game UI icon",
    "communism": "communist icon, red star, hammer and sickle, socialism, flat game UI icon",
    "fascism": "fascist icon, authoritarian, eagle symbol, totalitarian, flat game UI icon",
    "democracy": "democratic icon, ballot box, freedom, liberty, flat game UI icon",
    "trade": "trade icon, commerce, shipping, goods, flat game UI icon",
    "construction": "construction icon, building, crane, infrastructure, flat game UI icon",
    "training": "training icon, military drill, exercise, boot camp, flat game UI icon",
    "intelligence": "intelligence icon, spy, secret agent, espionage, flat game UI icon",
    "propaganda": "propaganda icon, megaphone, poster, broadcast, flat game UI icon",
    "default": "focus icon, flat design, game UI icon, simple shape, bold outline, centered, white background",
}


def parse_goals_gfx(gfx_path: Path) -> list[dict]:
    """Parse vanilla goals.gfx to extract SpriteType definitions."""
    sprites = []
    content = gfx_path.read_text(encoding="utf-8")

    pattern = re.compile(
        r'SpriteType\s*=\s*\{[^}]*?name\s*=\s*"?(GFX_\w+)"?[^}]*?'
        r'texturefile\s*=\s*"?([^"\s}]+)"?[^}]*?\}',
        re.DOTALL,
    )

    for match in pattern.finditer(content):
        gfx_name = match.group(1)
        texture_path = match.group(2).strip('"')
        if "focus_" in texture_path or "goal_" in texture_path:
            sprites.append({"gfx_name": gfx_name, "texturefile": texture_path})

    return sprites


def generate_prompt(gfx_name: str) -> str:
    """Generate an appropriate SD prompt based on the focus icon name."""
    name_lower = gfx_name.lower()
    matched_keywords = []
    for keyword, prompt in FOCUS_PROMPT_MAP.items():
        if keyword in name_lower:
            matched_keywords.append((len(keyword), prompt))

    if matched_keywords:
        matched_keywords.sort(key=lambda x: x[0], reverse=True)
        return matched_keywords[0][1]

    return FOCUS_PROMPT_MAP["default"]


def dds_to_png(dds_path: Path, png_path: Path) -> bool:
    """Convert DDS to PNG using ImageMagick."""
    try:
        result = subprocess.run(
            ["magick", str(dds_path), "-resize", f"{AI_IMAGE_SIZE}x{AI_IMAGE_SIZE}!", str(png_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(f"  [WARN] ImageMagick DDS→PNG failed: {result.stderr.strip()}")
            return False
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  [ERROR] DDS→PNG conversion failed: {e}")
        return False


def extract_alpha_from_dds(dds_path: Path, alpha_path: Path) -> bool:
    """Extract alpha channel from vanilla DDS as grayscale PNG mask."""
    try:
        result = subprocess.run(
            ["magick", str(dds_path), "-alpha", "extract", str(alpha_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(f"  [WARN] Alpha extraction failed: {result.stderr.strip()}")
            return False
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  [ERROR] Alpha extraction failed: {e}")
        return False


def apply_alpha_channel(png_path: Path, alpha_path: Path, output_path: Path) -> bool:
    """Composite alpha channel onto PNG image."""
    try:
        result = subprocess.run(
            [
                "magick",
                str(png_path),
                str(alpha_path),
                "-alpha", "off",
                "-compose", "copy_opacity",
                "-composite",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(f"  [WARN] Alpha compositing failed: {result.stderr.strip()}")
            return False
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  [ERROR] Alpha compositing failed: {e}")
        return False


def png_to_dds(png_path: Path, dds_path: Path) -> bool:
    """Convert PNG to DDS (ARGB8888) using ImageMagick."""
    try:
        result = subprocess.run(
            [
                "magick",
                str(png_path),
                "-resize",
                f"{HOI4_ICON_WIDTH}x{HOI4_ICON_HEIGHT}!",
                "-type",
                "TrueColorAlpha",
                "-define",
                "dds:compression=none",
                str(dds_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(f"  [WARN] ImageMagick PNG→DDS failed: {result.stderr.strip()}")
            return False
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  [ERROR] PNG→DDS conversion failed: {e}")
        return False


def comfyui_is_running() -> bool:
    """Check if ComfyUI API is accessible."""
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats", method="GET")
        with urllib.request.urlopen(req, timeout=5):
            return True
    except (urllib.error.URLError, ConnectionRefusedError, OSError):
        return False


def comfyui_queue_prompt(workflow: dict) -> str | None:
    """Submit a workflow to ComfyUI and return the prompt_id."""
    payload = json.dumps({"prompt": workflow, "client_id": str(uuid.uuid4())}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("prompt_id")
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"  [ERROR] ComfyUI API error: {e}")
        return None


def comfyui_wait_result(prompt_id: str, timeout: int = 120) -> list[str] | None:
    """Wait for ComfyUI to finish and return output image filenames."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                history = json.loads(resp.read())
                if prompt_id in history:
                    outputs = history[prompt_id].get("outputs", {})
                    images = []
                    for node_output in outputs.values():
                        if "images" in node_output:
                            for img in node_output["images"]:
                                images.append(img["filename"])
                    if images:
                        return images
        except (urllib.error.URLError, json.JSONDecodeError):
            pass
        time.sleep(2)
    return None


def comfyui_download_image(filename: str, save_path: Path) -> bool:
    """Download a generated image from ComfyUI."""
    try:
        url = f"{COMFYUI_URL}/view?filename={urllib.request.quote(filename)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            save_path.write_bytes(resp.read())
        return True
    except (urllib.error.URLError, OSError) as e:
        print(f"  [ERROR] Download failed: {e}")
        return False


def generate_gfx_file(sprites: list[dict], output_path: Path):
    """Generate a .gfx file with SpriteType entries for custom icons."""
    lines = [
        "spriteTypes = {",
        "    #### Custom focus icons generated by ComfyUI pipeline ####",
        "",
    ]
    for sprite in sprites:
        lines.append("    SpriteType = {")
        lines.append(f'        name = "{sprite["gfx_name"]}"')
        lines.append(f'        texturefile = "{sprite["texturefile"]}"')
        lines.append("    }")
        lines.append("")

    lines.append("}")
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[GFX] Generated: {output_path} ({len(sprites)} entries)")


def process_single_icon(
    sprite: dict,
    workflow_template: dict,
    dry_run: bool = False,
    prompt_override: str | None = None,
) -> dict | None:
    """Process a single focus icon through the pipeline."""
    gfx_name = sprite["gfx_name"]
    texture_rel = sprite["texturefile"]

    vanilla_dds = MOD_ROOT / "vanilla" / texture_rel
    if not vanilla_dds.exists():
        vanilla_dds = MOD_ROOT / texture_rel
    if not vanilla_dds.exists():
        print(f"  [SKIP] File not found: {vanilla_dds}")
        return None

    icon_filename = Path(texture_rel).name
    dds_stem = Path(texture_rel).stem
    output_dds = OUTPUT_DIR / icon_filename

    if output_dds.exists():
        print(f"  [SKIP] Already exists: {output_dds}")
        return None

    prompt = prompt_override or generate_prompt(gfx_name)
    print(f"  [PROMPT] {prompt[:80]}...")

    temp_png_input = TEMP_DIR / f"{dds_stem}_input.png"
    temp_png_output = TEMP_DIR / f"{dds_stem}_output.png"
    temp_alpha_mask = TEMP_DIR / f"{dds_stem}_alpha.png"
    temp_png_with_alpha = TEMP_DIR / f"{dds_stem}_output_alpha.png"

    if not dds_to_png(vanilla_dds, temp_png_input):
        return None

    if not extract_alpha_from_dds(vanilla_dds, temp_alpha_mask):
        print(f"  [WARN] Could not extract alpha, proceeding without transparency")

    if dry_run:
        print(f"  [DRY-RUN] Would send to ComfyUI: {temp_png_input}")
        return None

    workflow = json.loads(json.dumps(workflow_template))
    workflow["6"]["inputs"]["text"] = prompt
    workflow["10"]["inputs"]["image"] = str(temp_png_input)

    prompt_id = comfyui_queue_prompt(workflow)
    if not prompt_id:
        return None

    print(f"  [COMFYUI] Queued prompt_id={prompt_id[:12]}...")
    images = comfyui_wait_result(prompt_id, timeout=600)
    if not images:
        print(f"  [ERROR] ComfyUI timed out or returned no images")
        return None

    if not comfyui_download_image(images[0], temp_png_output):
        return None

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    png_for_dds = temp_png_output
    if temp_alpha_mask.exists():
        if apply_alpha_channel(temp_png_output, temp_alpha_mask, temp_png_with_alpha):
            png_for_dds = temp_png_with_alpha
            print(f"  [ALPHA] Applied transparency mask from vanilla")

    if not png_to_dds(png_for_dds, output_dds):
        return None

    print(f"  [OK] Generated: {output_dds}")

    relative_output = f"gfx/interface/goals/{icon_filename}"
    return {
        "gfx_name": gfx_name,
        "texturefile": relative_output,
    }


def main():
    parser = argparse.ArgumentParser(description="ComfyUI Focus Icon Pipeline for HOI4")
    parser.add_argument("--limit", type=int, default=0, help="Max icons to process (0=all)")
    parser.add_argument("--filter", type=str, default="", help="Filter icons by name substring")
    parser.add_argument("--dry-run", action="store_true", help="Parse and convert only, skip ComfyUI")
    parser.add_argument("--prompt", type=str, default="", help="Override prompt for all icons")
    parser.add_argument("--denoise", type=float, default=0.5, help="Denoise strength (0.0-1.0)")
    parser.add_argument("--seed", type=int, default=0, help="Random seed (0=random)")
    parser.add_argument("--no-skip-existing", action="store_true", default=False, help="Regenerate all icons even if they exist")
    parser.add_argument("--comfyui-url", type=str, default="", help="ComfyUI API URL (default: http://127.0.0.1:8188)")
    args = parser.parse_args()

    if args.comfyui_url:
        global COMFYUI_URL
        COMFYUI_URL = args.comfyui_url

    print("=" * 60)
    print("ComfyUI Focus Icon Pipeline for Hearts of Iron IV")
    print("=" * 60)

    if not VANILLA_GOALS_GFX.exists():
        print(f"[ERROR] Vanilla goals.gfx not found: {VANILLA_GOALS_GFX}")
        sys.exit(1)

    if not WORKFLOW_PATH.exists():
        print(f"[ERROR] Workflow file not found: {WORKFLOW_PATH}")
        sys.exit(1)

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    workflow_template = json.loads(WORKFLOW_PATH.read_text())
    workflow_template["3"]["inputs"]["denoise"] = args.denoise
    if args.seed:
        workflow_template["3"]["inputs"]["seed"] = args.seed

    print(f"\n[1/4] Parsing vanilla goals.gfx...")
    sprites = parse_goals_gfx(VANILLA_GOALS_GFX)
    print(f"  Found {len(sprites)} focus/goal sprites")

    if args.filter:
        sprites = [s for s in sprites if args.filter.lower() in s["gfx_name"].lower()]
        print(f"  After filter '{args.filter}': {len(sprites)} sprites")

    if args.limit > 0:
        sprites = sprites[: args.limit]
        print(f"  Limited to: {len(sprites)} sprites")

    if not args.dry_run:
        print(f"\n[2/4] Checking ComfyUI at {COMFYUI_URL}...")
        if not comfyui_is_running():
            print(f"  [ERROR] ComfyUI is not running at {COMFYUI_URL}")
            print(f"  Start it with: cd ~/ComfyUI && python3 main.py --listen 0.0.0.0")
            sys.exit(1)
        print("  ComfyUI is running!")
    else:
        print(f"\n[2/4] DRY-RUN mode, skipping ComfyUI check")

    print(f"\n[3/4] Processing {len(sprites)} icons...")
    generated = []
    skipped = 0
    failed = 0

    for i, sprite in enumerate(sprites, 1):
        gfx_name = sprite["gfx_name"]
        print(f"\n[{i}/{len(sprites)}] {gfx_name}")

        if not args.no_skip_existing:
            icon_filename = Path(sprite["texturefile"]).name
            output_dds = OUTPUT_DIR / icon_filename
            if output_dds.exists():
                print(f"  [SKIP] Already exists")
                skipped += 1
                continue

        prompt = args.prompt if args.prompt else None
        result = process_single_icon(sprite, workflow_template, args.dry_run, prompt)
        if result:
            generated.append(result)
        else:
            failed += 1

    print(f"\n[4/4] Generating .gfx file...")
    if generated:
        generate_gfx_file(generated, OUTPUT_GFX)
    else:
        print("  No new icons generated, skipping .gfx creation")

    print(f"\n{'=' * 60}")
    print(f"Pipeline complete!")
    print(f"  Generated: {len(generated)}")
    print(f"  Skipped:   {skipped}")
    print(f"  Failed:    {failed}")
    print(f"  Total:     {len(sprites)}")
    if generated:
        print(f"  Output:    {OUTPUT_DIR}")
        print(f"  GFX file:  {OUTPUT_GFX}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
