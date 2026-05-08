#!/usr/bin/env python3
"""
Generate custom focus icons for focuses listed in focuses.txt.

For each focus:
1. Finds its current vanilla icon from national focus files
2. Generates a NEW custom icon via ComfyUI img2img
3. Saves with new filename (focus_custom_*.dds)
4. Creates new GFX entry (GFX_focus_custom_*)
5. Generates .gfx file and update script for national focus files

Usage:
    python3 scripts/generate-focus-custom-icons.py [OPTIONS]
"""

import argparse
import json
import os
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
WORKFLOW_PATH = Path(__file__).parent / "comfyui-focus-icon-workflow.json"
MOD_ROOT = Path(__file__).parent.parent
FOCUSES_TXT = MOD_ROOT / "focuses.txt"
NF_DIR = MOD_ROOT / "BigLeninHistMod" / "common" / "national_focus"
VANILLA_GOALS_GFX = MOD_ROOT / "vanilla" / "interface" / "goals.gfx"
VANILLA_GOALS_DIR = MOD_ROOT / "vanilla" / "gfx" / "interface" / "goals"
OUTPUT_DIR = MOD_ROOT / "BigLeninHistMod" / "gfx" / "interface" / "goals"
OUTPUT_GFX = MOD_ROOT / "BigLeninHistMod" / "interface" / "custom_focus_icons.gfx"
TEMP_DIR = Path("/tmp/comfyui-focus-icons")

HOI4_ICON_WIDTH = 100
HOI4_ICON_HEIGHT = 88
AI_IMAGE_SIZE = 512
CHROMA_COLORS = {
    "chroma-green": (0, 255, 0, 255),
    "chroma-magenta": (255, 0, 255, 255),
}

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
    "communism": "communist icon, red star, hammer and sickle, socialism, flat game UI icon",
    "fascism": "fascist icon, authoritarian, eagle symbol, totalitarian, flat game UI icon",
    "democracy": "democratic icon, ballot box, freedom, liberty, flat game UI icon",
    "trade": "trade icon, commerce, shipping, goods, flat game UI icon",
    "construction": "construction icon, building, crane, infrastructure, flat game UI icon",
    "training": "training icon, military drill, exercise, boot camp, flat game UI icon",
    "intelligence": "intelligence icon, spy, secret agent, espionage, flat game UI icon",
    "propaganda": "propaganda icon, megaphone, poster, broadcast, flat game UI icon",
    "mobilization": "military mobilization icon, draft, reserves, army buildup, flat game UI icon",
    "offensive": "military offensive icon, attack, advance, charge, flat game UI icon",
    "defensive": "defensive icon, shield, fortification, defense line, flat game UI icon",
    "supply": "supply icon, logistics, truck, supply line, flat game UI icon",
    "wunderwaffe": "wonder weapon icon, advanced technology, secret weapon, futuristic, flat game UI icon",
    "jet": "jet aircraft icon, fighter jet, modern plane, speed, flat game UI icon",
    "rocket": "rocket icon, missile, V2, rocket technology, flat game UI icon",
    "penal": "penal battalion icon, punishment, discipline, military justice, flat game UI icon",
    "partisan": "partisan icon, resistance, guerrilla, underground, flat game UI icon",
    "winter": "winter warfare icon, snow, cold, frost, military, flat game UI icon",
    "default": "focus icon, flat design, game UI icon, simple shape, bold outline, centered, white background",
}

ORIGINAL_GFX_BY_FOCUS = {
    "BLHM_GER_develop_portuguese_mining": "GFX_goal_generic_construct_infrastructure",
    "BLHM_GER_invest_in_italian_industry": "GFX_goal_generic_construct_civ_factory",
    "BLHM_GER_libyan_industry": "GFX_focus_generic_industry_3",
    "BLHM_GER_mediterranean_exercises": "GFX_focus_generic_combined_arms",
    "BLHM_GER_prepare_east_african_sabotage": "GFX_focus_generic_military_mission",
    "BLHM_GER_spanish_african_bases": "GFX_goal_generic_navy_cruiser",
    "BLHM_GER_wunderwaffe_program": "GFX_focus_GER_wunderwaffe_inner_circle",
    "GER_consolidate_management_of_minor_powers": "GFX_focus_generic_industry_2",
    "GER_develop_hungarian_bauxite_deposits": "GFX_goal_generic_construct_civ_factory",
    "GER_diplomatic_pressure_on_potential_allies": "GFX_goal_generic_political_pressure",
    "GER_east_front_continue_offensive": "GFX_goal_generic_major_war",
    "GER_east_front_defensive_tactics": "GFX_goal_generic_fortify_city",
    "GER_east_front_destroy_partisans": "GFX_goal_generic_secret_weapon",
    "GER_east_front_final_blow": "GFX_goal_generic_attack_allies",
    "GER_east_front_fortify_lines": "GFX_goal_generic_construct_military",
    "GER_east_front_prepare_long_war": "GFX_goal_generic_war_with_comintern",
    "GER_east_front_prepare_second_winter": "GFX_goal_generic_construct_military",
    "GER_east_front_summer_campaign": "GFX_goal_generic_attack_allies",
    "GER_east_front_supply_routes": "GFX_goal_generic_construct_infrastructure",
    "GER_east_front_victory_or_death": "GFX_goal_generic_dangerous_deal",
    "GER_east_front_win_before_winter": "GFX_goal_generic_position_armies",
    "GER_expand_oil_extraction_in_ploesti": "GFX_goal_generic_oil_refinery",
    "GER_integrate_czech_manufacturers": "GFX_focus_PER_czech_tanks",
    "GER_sofia_initiative": "GFX_goal_generic_construct_mil_factory",
    "GER_wunderwaffe_e50": "GFX_focus_generic_army_tanks2",
    "GER_wunderwaffe_e50_unification": "GFX_focus_generic_army_tanks2",
    "GER_wunderwaffe_maus": "GFX_focus_generic_heavy_tank",
    "GER_wunderwaffe_me262": "GFX_focus_generic_jet_planes",
    "GER_wunderwaffe_rotte": "GFX_focus_generic_army_tanks2",
    "SOV_mobilization_first_wave": "GFX_focus_SOV_mobilization_plan",
    "SOV_mobilization_second_wave": "GFX_focus_generic_full_social_mobilization",
    "SOV_operation_bagration": "GFX_goal_generic_major_war",
    "SOV_order_227": "GFX_focus_SOV_penal_battalions",
}

SPECIFIC_FOCUS_PROMPTS = {
    "BLHM_GER_develop_portuguese_mining": "tungsten mining focus icon, mine tunnel entrance, ore cart with bright metal ore, pickaxe, industrial resource extraction",
    "BLHM_GER_mediterranean_exercises": "Mediterranean military exercises focus icon, warship and aircraft silhouettes, naval and air coordination, training maneuvers",
    "GER_east_front_prepare_long_war": "Eastern Front long war preparation focus icon, winter supply planning, map table, military logistics, determined army command",
}


def parse_focuses_txt(path: Path) -> list[str]:
    """Extract focus IDs from focuses.txt."""
    content = path.read_text()
    focus_ids = set()
    for line in content.split('\n'):
        for m in re.findall(r'\|\s*((?:BLHM_)?GER_\w+|(?:BLHM_)?SOV_\w+)\s*\|', line):
            focus_ids.add(m.strip())
    return sorted(focus_ids)


def find_focus_icons(focus_ids: list[str]) -> dict[str, dict]:
    """Map focus IDs to their current GFX icon and national focus file."""
    result = {}
    for nf_file in NF_DIR.glob('*.txt'):
        lines = nf_file.read_text(errors='ignore').split('\n')
        for i, line in enumerate(lines):
            for fid in focus_ids:
                if f'id = {fid}' in line or f'id = "{fid}"' in line:
                    for j in range(i + 1, min(i + 6, len(lines))):
                        icon_match = re.search(r'icon\s*=\s*(\S+)', lines[j])
                        if icon_match:
                            gfx = icon_match.group(1).strip().strip('"')
                            result[fid] = {
                                "gfx_name": gfx,
                                "nf_file": str(nf_file),
                                "nf_line": j + 1,
                            }
                            break
    return result


def find_gfx_dds(gfx_name: str) -> Path | None:
    """Find the DDS file for a GFX name in vanilla or generated mod sprite files."""
    gfx_files = [
        MOD_ROOT / "vanilla" / "interface" / "goals.gfx",
        OUTPUT_GFX,
    ]
    pattern = re.compile(
        rf'name\s*=\s*"?{re.escape(gfx_name)}"?'
        r'[^}}]*?texturefile\s*=\s*"?([^"\s}}]+)"?',
        re.DOTALL,
    )
    for gfx_file in gfx_files:
        if not gfx_file.exists():
            continue
        content = gfx_file.read_text(errors='ignore')
        match = pattern.search(content)
        if not match:
            continue
        texture_rel = match.group(1).strip('"')
        for root in (MOD_ROOT / "vanilla", MOD_ROOT / "BigLeninHistMod", MOD_ROOT):
            dds_path = root / texture_rel
            if dds_path.exists():
                return dds_path
    return None


def custom_gfx_name(focus_id: str) -> str:
    """Generate a custom GFX name for a focus."""
    return f"GFX_focus_custom_{focus_id}"


def custom_dds_filename(focus_id: str) -> str:
    """Generate a custom DDS filename for a focus."""
    return f"focus_custom_{focus_id}.dds"


def generate_prompt(focus_id: str) -> str:
    """Generate a prompt based on focus ID keywords."""
    if focus_id in SPECIFIC_FOCUS_PROMPTS:
        return SPECIFIC_FOCUS_PROMPTS[focus_id]
    name_lower = focus_id.lower()
    matched = []
    for keyword, prompt in FOCUS_PROMPT_MAP.items():
        if keyword in name_lower:
            matched.append((len(keyword), prompt))
    if matched:
        matched.sort(key=lambda x: x[0], reverse=True)
        return matched[0][1]
    return FOCUS_PROMPT_MAP["default"]


def prompt_for_approach(base_prompt: str, approach: str) -> str:
    if approach not in CHROMA_COLORS:
        return base_prompt
    hex_color = "#00ff00" if approach == "chroma-green" else "#ff00ff"
    return (
        f"{base_prompt}, high quality Hearts of Iron IV national focus icon, "
        f"sharp readable silhouette, painterly WW2 strategy game UI art, centered single subject, "
        f"perfectly flat solid {hex_color} background, no frame, no border, no text, no watermark, "
        f"do not use {hex_color} in the subject"
    )


def extract_alpha(dds_path: Path, alpha_path: Path) -> bool:
    try:
        result = subprocess.run(
            ["magick", str(dds_path), "-alpha", "extract", str(alpha_path)],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def apply_alpha(src: Path, alpha: Path, dst: Path) -> bool:
    try:
        result = subprocess.run(
            ["magick", str(src), str(alpha), "-alpha", "off",
             "-compose", "copy_opacity", "-composite", str(dst)],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def dds_to_png(dds_path: Path, png_path: Path) -> bool:
    try:
        result = subprocess.run(
            ["magick", str(dds_path), "-resize", f"{AI_IMAGE_SIZE}x{AI_IMAGE_SIZE}!", str(png_path)],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def prepare_input_png(dds_path: Path, png_path: Path, approach: str) -> bool:
    if approach not in CHROMA_COLORS:
        return dds_to_png(dds_path, png_path)
    try:
        img = Image.open(dds_path).convert("RGBA").resize((AI_IMAGE_SIZE, AI_IMAGE_SIZE), Image.Resampling.LANCZOS)
        background = Image.new("RGBA", img.size, CHROMA_COLORS[approach])
        background.alpha_composite(img)
        background.convert("RGB").save(png_path)
        return True
    except Exception:
        return False


def png_to_dds(png_path: Path, dds_path: Path) -> bool:
    try:
        result = subprocess.run(
            ["magick", str(png_path), "-resize", f"{HOI4_ICON_WIDTH}x{HOI4_ICON_HEIGHT}!",
             "-type", "TrueColorAlpha", "-define", "dds:compression=none", str(dds_path)],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def fill_internal_alpha_holes(src_path: Path, dst_path: Path) -> bool:
    """Keep only edge-connected transparency so icon interiors do not become cut out."""
    try:
        img = Image.open(src_path).convert("RGBA").resize(
            (HOI4_ICON_WIDTH, HOI4_ICON_HEIGHT), Image.Resampling.LANCZOS
        )
        w, h = img.size
        pix = img.load()
        queue = deque()
        edge_transparent = set()

        def is_transparent(x: int, y: int) -> bool:
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
                if (
                    0 <= nx < w
                    and 0 <= ny < h
                    and (nx, ny) not in edge_transparent
                    and is_transparent(nx, ny)
                ):
                    edge_transparent.add((nx, ny))
                    queue.append((nx, ny))

        for y in range(h):
            for x in range(w):
                r, g, b, a = pix[x, y]
                if (x, y) in edge_transparent:
                    pix[x, y] = (r, g, b, 0)
                elif a < 255:
                    # Preserve interior detail by making isolated alpha holes opaque.
                    pix[x, y] = (r, g, b, 255)

        img.save(dst_path)
        return True
    except Exception:
        return False


def png_to_dds_no_resize(png_path: Path, dds_path: Path) -> bool:
    try:
        result = subprocess.run(
            [
                "magick",
                str(png_path),
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
        return result.returncode == 0
    except Exception:
        return False


def remove_chroma_background(src_path: Path, dst_path: Path, approach: str) -> bool:
    """Remove only edge-connected chroma-key background, preserving internal dark icon detail."""
    if approach not in CHROMA_COLORS:
        return False

    key = CHROMA_COLORS[approach][:3]
    tolerance = 82
    try:
        img = Image.open(src_path).convert("RGBA")
        w, h = img.size
        pix = img.load()

        def is_key(x: int, y: int) -> bool:
            r, g, b, a = pix[x, y]
            return a > 0 and sum(abs(c - k) for c, k in zip((r, g, b), key)) <= tolerance

        queue = deque()
        seen = set()
        for x in range(w):
            for y in (0, h - 1):
                if is_key(x, y):
                    queue.append((x, y))
                    seen.add((x, y))
        for y in range(h):
            for x in (0, w - 1):
                if (x, y) not in seen and is_key(x, y):
                    queue.append((x, y))
                    seen.add((x, y))

        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and is_key(nx, ny):
                    seen.add((nx, ny))
                    queue.append((nx, ny))

        out = img.copy()
        out_pix = out.load()
        for x, y in seen:
            r, g, b, _ = out_pix[x, y]
            out_pix[x, y] = (r, g, b, 0)
        out.save(dst_path)
        return True
    except Exception:
        return False


def comfyui_is_running() -> bool:
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats", method="GET")
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def comfyui_queue_prompt(workflow: dict) -> str | None:
    payload = json.dumps({"prompt": workflow, "client_id": str(uuid.uuid4())}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read()).get("prompt_id")
    except Exception:
        return None


def comfyui_wait_result(prompt_id: str, timeout: int = 600) -> list[str] | None:
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                history = json.loads(resp.read())
                if prompt_id in history:
                    outputs = history[prompt_id].get("outputs", {})
                    for node_output in outputs.values():
                        if "images" in node_output:
                            return [img["filename"] for img in node_output["images"]]
        except Exception:
            pass
        time.sleep(2)
    return None


def comfyui_download_image(filename: str, save_path: Path) -> bool:
    try:
        url = f"{COMFYUI_URL}/view?filename={urllib.request.quote(filename)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            save_path.write_bytes(resp.read())
        return True
    except Exception:
        return False


def generate_gfx_file(sprites: list[dict], output_path: Path):
    lines = [
        "spriteTypes = {",
        "    #### Custom focus icons generated by ComfyUI pipeline ####",
        "",
    ]
    for s in sprites:
        lines.append("    SpriteType = {")
        lines.append(f'        name = "{s["gfx_name"]}"')
        lines.append(f'        texturefile = "{s["texturefile"]}"')
        lines.append("    }")
        lines.append("")
    lines.append("}")
    lines.append("")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[GFX] Generated: {output_path} ({len(sprites)} entries)")


def generate_update_script(updates: list[dict], output_path: Path):
    """Generate a script to update national focus files with new icon references."""
    lines = [
        "#!/usr/bin/env python3",
        '"""Auto-generated script to update national focus icon references."""',
        "",
        "import re",
        "from pathlib import Path",
        "",
        "UPDATES = [",
    ]
    for u in updates:
        lines.append(f'    {{"nf_file": "{u["nf_file"]}", "line": {u["line"]}, '
                     f'"old": "{u["old_icon"]}", "new": "{u["new_icon"]}"}},')
    lines.append("]")
    lines.append("")
    lines.append("for u in UPDATES:")
    lines.append("    p = Path(u['nf_file'])")
    lines.append("    lines = p.read_text(encoding='utf-8').split('\\n')")
    lines.append("    i = u['line'] - 1")
    lines.append("    if i < len(lines) and u['old'] in lines[i]:")
    lines.append("        lines[i] = lines[i].replace(u['old'], u['new'])")
    lines.append("        p.write_text('\\n'.join(lines), encoding='utf-8')")
    lines.append("        print(f'Updated: {p}:{u[\"line\"]}  {u[\"old\"]} -> {u[\"new\"]}')")
    lines.append("    else:")
    lines.append("        print(f'SKIP (line changed): {p}:{u[\"line\"]}')")
    lines.append("")

    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[SCRIPT] Generated: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate custom focus icons from focuses.txt")
    parser.add_argument("--limit", type=int, default=0, help="Max focuses to process")
    parser.add_argument("--filter", type=str, default="", help="Filter by focus ID substring")
    parser.add_argument("--dry-run", action="store_true", help="Skip ComfyUI, just parse")
    parser.add_argument("--prompt", type=str, default="", help="Override prompt for all")
    parser.add_argument("--denoise", type=float, default=0.5, help="Denoise strength")
    parser.add_argument("--seed", type=int, default=0, help="Random seed")
    parser.add_argument("--ids", type=str, default="", help="Comma-separated focus IDs to process")
    parser.add_argument("--force", action="store_true", help="Regenerate existing output files")
    parser.add_argument(
        "--approach",
        choices=["vanilla-alpha", "chroma-green", "chroma-magenta", "opaque"],
        default="chroma-magenta",
        help="Transparency strategy. Chroma approaches generate on a key background, then remove it.",
    )
    parser.add_argument("--variant-suffix", type=str, default="", help="Append suffix before .dds for test variants")
    parser.add_argument("--steps", type=int, default=32, help="Sampler steps")
    parser.add_argument("--cfg", type=float, default=7.5, help="CFG scale")
    parser.add_argument("--sampler", type=str, default="dpmpp_2m", help="ComfyUI sampler_name")
    parser.add_argument("--scheduler", type=str, default="karras", help="ComfyUI scheduler")
    parser.add_argument("--ai-size", type=int, default=768, help="ComfyUI working size")
    parser.add_argument(
        "--source",
        choices=["current", "original"],
        default="original",
        help="Use original vanilla icon source or current focus icon source for img2img",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Custom Focus Icon Generator (focuses.txt)")
    print("=" * 60)

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    workflow_template = json.loads(WORKFLOW_PATH.read_text())
    workflow_template["3"]["inputs"]["denoise"] = args.denoise
    workflow_template["3"]["inputs"]["steps"] = args.steps
    workflow_template["3"]["inputs"]["cfg"] = args.cfg
    workflow_template["3"]["inputs"]["sampler_name"] = args.sampler
    workflow_template["3"]["inputs"]["scheduler"] = args.scheduler
    workflow_template["12"]["inputs"]["width"] = args.ai_size
    workflow_template["12"]["inputs"]["height"] = args.ai_size
    if args.seed:
        workflow_template["3"]["inputs"]["seed"] = args.seed

    print(f"\n[1/5] Parsing focuses.txt...")
    focus_ids = parse_focuses_txt(FOCUSES_TXT)
    print(f"  Found {len(focus_ids)} focus IDs")

    if args.filter:
        focus_ids = [f for f in focus_ids if args.filter.lower() in f.lower()]
        print(f"  After filter: {len(focus_ids)}")

    if args.ids:
        wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
        focus_ids = [f for f in focus_ids if f in wanted]
        missing = sorted(wanted - set(focus_ids))
        print(f"  After explicit IDs: {len(focus_ids)}")
        if missing:
            print(f"  [WARN] IDs not found in focuses.txt: {', '.join(missing)}")

    if args.limit > 0:
        focus_ids = focus_ids[:args.limit]
        print(f"  Limited to: {len(focus_ids)}")

    print(f"\n[2/5] Mapping focuses to current icons...")
    focus_map = find_focus_icons(focus_ids)
    print(f"  Mapped {len(focus_map)}/{len(focus_ids)} focuses")

    if not args.dry_run:
        print(f"\n[3/5] Checking ComfyUI at {COMFYUI_URL}...")
        if not comfyui_is_running():
            print(f"  [ERROR] ComfyUI not running!")
            print(f"  Start: cd ~/ComfyUI && python3 main.py --listen 0.0.0.0 --port 8188")
            sys.exit(1)
        print("  OK!")

    print(f"\n[4/5] Generating custom icons...")
    generated = []
    updates = []
    failed = 0

    for i, fid in enumerate(focus_ids, 1):
        if fid not in focus_map:
            print(f"\n[{i}/{len(focus_ids)}] {fid} - [SKIP] No icon mapping found")
            continue

        info = focus_map[fid]
        old_gfx = info["gfx_name"]
        source_gfx = ORIGINAL_GFX_BY_FOCUS.get(fid, old_gfx) if args.source == "original" else old_gfx
        new_gfx = custom_gfx_name(fid)
        new_dds_name = custom_dds_filename(fid)
        if args.variant_suffix:
            new_dds_name = f"{Path(new_dds_name).stem}{args.variant_suffix}.dds"
        output_dds = OUTPUT_DIR / new_dds_name

        print(f"\n[{i}/{len(focus_ids)}] {fid}")
        print(f"  Old: {old_gfx}")
        print(f"  Source: {source_gfx}")
        print(f"  New: {new_gfx}")

        if output_dds.exists() and not args.force:
            print(f"  [SKIP] Already exists: {output_dds}")
            generated.append({"gfx_name": new_gfx, "texturefile": f"gfx/interface/goals/{new_dds_name}"})
            continue

        source_dds = find_gfx_dds(source_gfx)
        if not source_dds:
            print(f"  [SKIP] Source DDS not found for {source_gfx}")
            failed += 1
            continue

        prompt = prompt_for_approach(args.prompt or generate_prompt(fid), args.approach)
        print(f"  [PROMPT] {prompt[:70]}...")

        temp_png_input = TEMP_DIR / f"{fid}_input.png"
        temp_png_output = TEMP_DIR / f"{fid}_output.png"
        temp_alpha = TEMP_DIR / f"{fid}_alpha.png"
        temp_out_alpha = TEMP_DIR / f"{fid}_out_alpha.png"

        if not prepare_input_png(source_dds, temp_png_input, args.approach):
            print(f"  [ERROR] DDS→PNG failed")
            failed += 1
            continue

        if args.approach == "vanilla-alpha":
            extract_alpha(source_dds, temp_alpha)

        if args.dry_run:
            print(f"  [DRY-RUN] Would send to ComfyUI")
            continue

        workflow = json.loads(json.dumps(workflow_template))
        workflow["6"]["inputs"]["text"] = prompt
        workflow["10"]["inputs"]["image"] = str(temp_png_input)

        prompt_id = comfyui_queue_prompt(workflow)
        if not prompt_id:
            print(f"  [ERROR] Failed to queue")
            failed += 1
            continue

        print(f"  [COMFYUI] Queued {prompt_id[:12]}...")
        images = comfyui_wait_result(prompt_id, timeout=600)
        if not images:
            print(f"  [ERROR] Timeout")
            failed += 1
            continue

        if not comfyui_download_image(images[0], temp_png_output):
            print(f"  [ERROR] Download failed")
            failed += 1
            continue

        png_for_dds = temp_png_output
        if args.approach in CHROMA_COLORS:
            if remove_chroma_background(temp_png_output, temp_out_alpha, args.approach):
                png_for_dds = temp_out_alpha
                print(f"  [ALPHA] Removed edge-connected chroma background")
            else:
                print(f"  [WARN] Chroma background removal failed")
        elif args.approach == "vanilla-alpha" and temp_alpha.exists():
            if apply_alpha(temp_png_output, temp_alpha, temp_out_alpha):
                png_for_dds = temp_out_alpha
                print(f"  [ALPHA] Transparency applied")

        if args.approach in CHROMA_COLORS:
            temp_final_alpha = TEMP_DIR / f"{fid}_final_alpha.png"
            if fill_internal_alpha_holes(png_for_dds, temp_final_alpha):
                png_for_dds = temp_final_alpha
                print(f"  [ALPHA] Filled isolated internal alpha holes")
                converted = png_to_dds_no_resize(png_for_dds, output_dds)
            else:
                converted = png_to_dds(png_for_dds, output_dds)
        else:
            converted = png_to_dds(png_for_dds, output_dds)

        if not converted:
            print(f"  [ERROR] PNG→DDS failed")
            failed += 1
            continue

        print(f"  [OK] {output_dds}")
        generated.append({"gfx_name": new_gfx, "texturefile": f"gfx/interface/goals/{new_dds_name}"})
        updates.append({
            "nf_file": info["nf_file"],
            "line": info["nf_line"],
            "old_icon": old_gfx,
            "new_icon": new_gfx,
        })

    print(f"\n[5/5] Generating output files...")
    if generated and not args.variant_suffix:
        generate_gfx_file(generated, OUTPUT_GFX)
    elif generated:
        print("  [VARIANT] Test variant files generated; leaving .gfx and focus references unchanged")
    if updates and not args.dry_run and not args.variant_suffix:
        update_script = MOD_ROOT / "scripts" / "update-focus-icons.py"
        generate_update_script(updates, update_script)

    print(f"\n{'=' * 60}")
    print(f"Done!")
    print(f"  Generated: {len(generated)}")
    print(f"  Failed:    {failed}")
    print(f"  Total:     {len(focus_ids)}")
    if updates:
        print(f"\n  To apply icon changes to national focus files:")
        print(f"    python3 scripts/update-focus-icons.py")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
