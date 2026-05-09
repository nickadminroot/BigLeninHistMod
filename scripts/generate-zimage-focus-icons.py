#!/usr/bin/env python3
"""
Z-Image Focus Icon Generator for Hearts of Iron IV

Generates custom focus icons using Z-Image (GGUF) via ComfyUI API.
Text2img mode with flat solid background for easy rembg removal.

Workflow:
  1. Generate image at full resolution (512 or 1024)
  2. Remove background with rembg (full res)
  3. Crop transparent margins (full res)
  4. Fill internal alpha holes (full res)
  5. Downscale to 100x88 and convert to DDS

Usage:
    python3 scripts/generate-zimage-focus-icons.py [OPTIONS]
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

from PIL import Image, ImageDraw


COMFYUI_URL = "http://127.0.0.1:8188"
MOD_ROOT = Path(__file__).parent.parent
FOCUSES_TXT = MOD_ROOT / "focuses.txt"
NF_DIR = MOD_ROOT / "BigLeninHistMod" / "common" / "national_focus"
OUTPUT_DIR = MOD_ROOT / "BigLeninHistMod" / "gfx" / "interface" / "goals"
OUTPUT_GFX = MOD_ROOT / "BigLeninHistMod" / "interface" / "custom_focus_icons.gfx"
TEMP_DIR = Path("/tmp/zimage-focus-icons")
PREVIEW_DIR = OUTPUT_DIR / "_previews"

HOI4_ICON_WIDTH = 100
HOI4_ICON_HEIGHT = 88

NEGATIVE_PROMPT = (
    "текст, буквы, цифры, логотипы, водяной знак, современная техника, "
    "современная униформа, мультяшный стиль, аниме, яркие неоновые цвета, "
    "чистый UI-интерфейс, белый фон, размытость, низкая детализация, "
    "плоская векторная графика, фотография, лишние объекты, обрезанный главный объект, "
    "неправильная перспектива, рамки, бордюры"
)

FOCUS_DESCRIPTIONS = {
    "BLHM_GER_develop_portuguese_mining": (
        "вагонетка полная блестящих кристаллов вольфрама, "
        "скрещённые кирка и бур за ней, горный тоннель на фоне"
    ),
    "BLHM_GER_invest_in_italian_industry": (
        "сталелитейный завод с высокими дымящими трубами, "
        "раскалённый металл течёт по желобу, искры летят"
    ),
    "BLHM_GER_libyan_industry": (
        "нефтяная вышка-качалка в пустыне, песчаные дюны на фоне, "
        "закатное солнце, буровая установка"
    ),
    "BLHM_GER_mediterranean_exercises": (
        "тяжёлый крейсер на море, палубный самолёт пролетает над ним, "
        "волны, средиземноморское побережье на горизонте"
    ),
    "BLHM_GER_prepare_east_african_sabotage": (
        "разрушенный железнодорожный мост в африканской саванне, "
        "обрушенные рельсы, взорванные опоры, дерево акации на фоне"
    ),
    "BLHM_GER_spanish_african_bases": (
        "морской маяк на скалистом берегу, военные корабли в гавани, "
        "портовые краны, испанский флаг"
    ),
    "BLHM_GER_wunderwaffe_program": (
        "ракета V2 вертикально стоит на пусковой площадке, "
        "учёные в белых халатах с чертежами, секретная лаборатория"
    ),
    "GER_consolidate_management_of_minor_powers": (
        "карта Центральной Европы с выделенными территориями "
        "Венгрии Румынии и Болгарии, стрелки сходятся к Берлину"
    ),
    "GER_develop_hungarian_bauxite_deposits": (
        "открытый карьер с красной бокситовой породой, "
        "экскаватор на краю карьера, горы бокситовой руды"
    ),
    "GER_diplomatic_pressure_on_potential_allies": (
        "две руки в кожаных перчатках пожимают друг друга над картой Европы, "
        "дипломатические документы и печати на столе"
    ),
    "GER_east_front_continue_offensive": (
        "колонна танков Panzer IV идёт в атаку по открытому полю, "
        "дым от выстрелов, красные звёзды на броне вражеских танков вдали"
    ),
    "GER_east_front_defensive_tactics": (
        "бетонный бункер с пулемётной амбразурой, "
        "колючая проволока и противотанковые ежи перед ним"
    ),
    "GER_east_front_destroy_partisans": (
        "немецкий солдат в зимнем камуфляже с автоматом MP40, "
        "заснеженный хвойный лес на фоне"
    ),
    "GER_east_front_final_blow": (
        "тяжёлая гаубица калибра 150мм в момент выстрела, "
        "огненный заряд из дула, клубы порохового дыма"
    ),
    "GER_east_front_fortify_lines": (
        "линия бетонных дотов и дзотов с амбразурами, "
        "противотанковый ров и проволочные заграждения"
    ),
    "GER_east_front_prepare_long_war": (
        "колонна военных грузовиков Opel Blitz гружённых ящиками, "
        "тянутся по грунтовой дороге в тумане"
    ),
    "GER_east_front_prepare_second_winter": (
        "стальной шлем M35 покрытый толстым слоем снега и инея, "
        "ледяные сосульки свисают с козырька"
    ),
    "GER_east_front_summer_campaign": (
        "танк Panzer III на пыльной степной дороге, "
        "солнце в зените, пыль поднимается от гусениц"
    ),
    "GER_east_front_supply_routes": (
        "длинный грузовой поезд с цистернами идёт по мосту, "
        "паровоз выпускает дым, рельсы уходят вдаль"
    ),
    "GER_east_front_victory_or_death": (
        "развевающееся военное знамя с железным крестом, "
        "ткань рвётся на ветру, драматичное освещение"
    ),
    "GER_east_front_win_before_winter": (
        "большие настенные часы с красной стрелкой на декабре, "
        "снежинки на циферблате, ощущение спешки"
    ),
    "GER_expand_oil_extraction_in_ploesti": (
        "нефтяная вышка-качалка на фоне нефтеперерабатывающего завода, "
        "цистерны с нефтью, румынские Карпаты на горизонте"
    ),
    "GER_integrate_czech_manufacturers": (
        "танк LT-38 на заводском конвейере, "
        "рабочие собирают бронекорпус, заводские цеха на фоне"
    ),
    "GER_sofia_initiative": (
        "здание болгарского парламента в Софии, "
        "немецкий и болгарский флаги рядом, дипломатическая встреча"
    ),
    "GER_wunderwaffe_e50": (
        "танк E-50 в профиль, наклонная лобовая броня, "
        "длинная пушка KwK 42, стальные гусеницы"
    ),
    "GER_wunderwaffe_e50_unification": (
        "чертёж танка E-50 на столе, рядом детали и инструменты, "
        "стандартные узлы и агрегаты разложены по полкам"
    ),
    "GER_wunderwaffe_maus": (
        "сверхтяжёлый танк Маус в три четверти, "
        "массивная башня с пушкой 128мм, толстая лобовая броня"
    ),
    "GER_wunderwaffe_me262": (
        "реактивный истребитель Me-262 в полёте, "
        "два реактивных двигателя под крылом, стреловидное крыло"
    ),
    "GER_wunderwaffe_rotte": (
        "два истребителя Bf-109 летят парой в небе, "
        "ведущий и ведомый, тактическая схема воздушного боя"
    ),
    "SOV_mobilization_first_wave": (
        "First Wave of Mobilization. Central image: a small group of Soviet Red Army reservists "
        "in 1940s greatcoats and steel helmets standing before a mobilization order and a red military banner, "
        "with a rifle, field pack, and red star in the foreground"
    ),
    "SOV_mobilization_second_wave": (
        "Second Wave of Mobilization. Central image: a mass column of Soviet soldiers marching forward, "
        "with an officer in the foreground holding a clipboard and mobilization lists, "
        "railway troop trains and barracks silhouettes behind them"
    ),
    "SOV_operation_bagration": (
        "Operation Bagration. Central image: a Soviet T-34 tank breaking through a shattered enemy "
        "defensive line, with a torn front-line map beneath it, artillery flashes in the background, "
        "and a red banner rising behind the tank"
    ),
    "SOV_order_227": (
        "Order 227. Central image: a severe stone tablet or heavy metal military order engraved with "
        "abstract marks, bearing a red Soviet star at the top, with crossed Mosin rifles and a steel helmet "
        "behind it; below, a trench line with barbed wire and anti-retreat symbolism"
    ),
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


def make_prompt(focus_id: str) -> str:
    desc = FOCUS_DESCRIPTIONS.get(focus_id, "военный символ Второй мировой войны")
    return (
        f"Создай иконку национального фокуса в стиле мрачной военно-исторической "
        f"стратегической игры середины XX века. Центральный объект: {desc}. "
        f"Иконка должна выглядеть как эмблема на темном металлическом или каменном "
        f"медальоне, с декоративной золотой или бронзовой рамкой, лавровыми ветвями, "
        f"шестернями, щитом или орнаментом. "
        f"Стиль: реалистично-иллюстративный, детализированная игровая иконка, "
        f"дизельпанк, военная эстетика 1930–1940-х годов, драматичное освещение, "
        f"высокий контраст, слегка потертая текстура, патина, металл, эмаль, гравировка. "
        f"Композиция: объект по центру, фронтальный ракурс, читаемый силуэт, "
        f"симметричная геральдическая композиция, без текста, без букв, без цифр, "
        f"без интерфейса, без фона карты, только сама иконка. "
        f"Цветовая палитра: темные серые, черные, стальные и бронзовые тона, "
        f"приглушенное золото, красные или белые акценты при необходимости. "
        f"Формат: квадратная игровая иконка, 1:1, высокая детализация, sharp focus, "
        f"polished game asset, suitable for a strategy game focus tree. "
        f"ВАЖНО: фон должен быть абсолютно ровным, однородным, однотонным "
        f"темно-серым цветом без градиентов, без текстур, без паттернов, "
        f"без виньетирования, без затемнений по краям, идеально плоский фон "
        f"для легкого удаления."
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
    workflow = {
        "67": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["62", 0],
            },
        },
        "63": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": vae_name,
            },
        },
        "62": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": clip_name,
                "type": "lumina2",
                "device": "default",
            },
        },
        "65": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["69", 0],
                "vae": ["63", 0],
            },
        },
        "70": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {
                "shift": 3,
                "model": ["94", 0],
            },
        },
        "71": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["62", 0],
            },
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
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1,
            },
        },
        "94": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {
                "unet_name": unet_name,
            },
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "zimage-focus",
                "images": ["65", 0],
            },
        },
    }
    return workflow


def comfyui_is_running() -> bool:
    print("  [CHECK] Pinging ComfyUI...")
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats", method="GET")
        with urllib.request.urlopen(req, timeout=5):
            print("  [CHECK] ComfyUI is alive")
            return True
    except Exception:
        print("  [CHECK] ComfyUI is NOT reachable")
        return False


def comfyui_queue_prompt(workflow: dict) -> str | None:
    print("  [COMFYUI] Sending prompt to queue...")
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
                            print(f"  [COMFYUI] Done in {elapsed:.0f}s, got {len(fnames)} image(s)")
                            return fnames
        except Exception:
            pass
        now = time.time()
        if now - last_print > 15:
            elapsed = now - start
            print(f"  [COMFYUI] Still waiting... {elapsed:.0f}s elapsed")
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
            print(f"  [DOWNLOAD] Saved {len(data)} bytes to {save_path.name}")
        return True
    except Exception as e:
        print(f"  [DOWNLOAD] Failed: {e}")
        return False


def remove_background_rembg(src_path: Path, dst_path: Path) -> bool:
    print(f"  [REMBG] Removing background from {src_path.name}...")
    try:
        from rembg import remove
    except Exception:
        print(f"  [REMBG] rembg not installed")
        return False
    try:
        img = Image.open(src_path).convert("RGBA")
        print(f"  [REMBG] Input size: {img.size}")
        out = remove(img)
        out.save(dst_path)
        print(f"  [REMBG] Background removed, saved to {dst_path.name}")
        return True
    except Exception as e:
        print(f"  [REMBG] Failed: {e}")
        return False


def crop_transparent_margins(src_path: Path, dst_path: Path, padding: int = 4) -> bool:
    """Crop transparent margins at FULL resolution, keeping a small padding."""
    print(f"  [CROP] Cropping transparent margins from {src_path.name}...")
    try:
        img = Image.open(src_path).convert("RGBA")
        w, h = img.size
        alpha = img.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            print(f"  [CROP] Entire image is transparent, skipping crop")
            img.save(dst_path)
            return True
        x0, y0, x1, y1 = bbox
        # Add padding but stay within bounds
        x0 = max(0, x0 - padding)
        y0 = max(0, y0 - padding)
        x1 = min(w, x1 + padding)
        y1 = min(h, y1 + padding)
        cropped = img.crop((x0, y0, x1, y1))
        cropped.save(dst_path)
        print(f"  [CROP] Cropped from {w}x{h} to {cropped.size[0]}x{cropped.size[1]}")
        return True
    except Exception as e:
        print(f"  [CROP] Failed: {e}")
        return False


def fill_internal_alpha_holes(src_path: Path, dst_path: Path) -> bool:
    """Fill isolated transparent holes inside the icon at FULL resolution."""
    print(f"  [ALPHA] Filling internal alpha holes in {src_path.name}...")
    try:
        img = Image.open(src_path).convert("RGBA")
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
                    0 <= nx < w and 0 <= ny < h
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
                    pix[x, y] = (r, g, b, 255)

        img.save(dst_path)
        print(f"  [ALPHA] Done, saved to {dst_path.name}")
        return True
    except Exception as e:
        print(f"  [ALPHA] Failed: {e}")
        return False


def png_to_dds(png_path: Path, dds_path: Path) -> bool:
    """Resize to HOI4 icon size and convert to DDS."""
    print(f"  [DDS] Converting {png_path.name} → {dds_path.name} (resize to {HOI4_ICON_WIDTH}x{HOI4_ICON_HEIGHT})...")
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
        else:
            print(f"  [DDS] ImageMagick error: {result.stderr.strip()}")
            return False
    except Exception as e:
        print(f"  [DDS] Failed: {e}")
        return False


def make_preview(src_path: Path, preview_path: Path) -> bool:
    try:
        icon = Image.open(src_path).convert("RGBA").resize(
            (HOI4_ICON_WIDTH, HOI4_ICON_HEIGHT), Image.Resampling.LANCZOS
        )
        scale = 4
        cell = 8
        bg = Image.new("RGBA", icon.size, (44, 47, 50, 255))
        draw = ImageDraw.Draw(bg)
        for y in range(0, icon.height, cell):
            for x in range(0, icon.width, cell):
                if (x // cell + y // cell) % 2 == 0:
                    draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(92, 96, 101, 255))
        bg.alpha_composite(icon)
        preview = bg.resize((icon.width * scale, icon.height * scale), Image.Resampling.NEAREST)
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        preview.save(preview_path)
        return True
    except Exception:
        return False


def alpha_report(image_path: Path) -> dict:
    img = Image.open(image_path).convert("RGBA").resize(
        (HOI4_ICON_WIDTH, HOI4_ICON_HEIGHT), Image.Resampling.LANCZOS
    )
    w, h = img.size
    alpha = img.getchannel("A")
    values = list(alpha.get_flattened_data())
    transparent = {i for i, a in enumerate(values) if a < 128}
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((w - 1, 0)), alpha.getpixel((0, h - 1)), alpha.getpixel((w - 1, h - 1))]

    queue = deque()
    edge = set()
    for x in range(w):
        for y in (0, h - 1):
            idx = y * w + x
            if idx in transparent:
                queue.append((x, y))
                edge.add(idx)
    for y in range(h):
        for x in (0, w - 1):
            idx = y * w + x
            if idx in transparent and idx not in edge:
                queue.append((x, y))
                edge.add(idx)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                idx = ny * w + nx
                if idx in transparent and idx not in edge:
                    edge.add(idx)
                    queue.append((nx, ny))

    return {
        "has_alpha": min(values) < 255,
        "transparent_corners": all(a < 128 for a in corners),
        "transparent_pixels": len(transparent),
        "internal_holes": len(transparent - edge),
    }


def generate_gfx_file(sprites: list[dict], output_path: Path):
    lines = [
        "spriteTypes = {",
        "    #### Custom focus icons generated by Z-Image pipeline ####",
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


def main():
    parser = argparse.ArgumentParser(description="Z-Image Focus Icon Generator")
    parser.add_argument("--limit", type=int, default=0, help="Max focuses to process (0=all pending)")
    parser.add_argument("--filter", type=str, default="", help="Filter by focus ID substring")
    parser.add_argument("--dry-run", action="store_true", help="Skip ComfyUI")
    parser.add_argument("--seed", type=int, default=0, help="Random seed (0=random)")
    parser.add_argument("--force", action="store_true", help="Regenerate existing")
    parser.add_argument("--steps", type=int, default=35, help="Sampler steps")
    parser.add_argument("--cfg", type=float, default=4.0, help="CFG scale")
    parser.add_argument("--ai-size", type=int, default=512, help="Generation size (512 or 1024)")
    parser.add_argument("--unet", type=str, default="z-image-Q8_0.gguf", help="UNET model name")
    parser.add_argument("--clip", type=str, default="qwen_3_4b.safetensors", help="CLIP model name")
    parser.add_argument("--vae", type=str, default="ae.safetensors", help="VAE model name")
    parser.add_argument("--negative-prompt", type=str, default="", help="Override negative prompt")
    parser.add_argument("--ids", type=str, default="", help="Comma-separated focus IDs")
    parser.add_argument("--variant-suffix", type=str, default="", help="Suffix for variant files")
    parser.add_argument("--batch-start", type=int, default=0, help="Start index for batch processing (0-based)")
    parser.add_argument("--batch-size", type=int, default=0, help="Max icons to process in this batch (0=all pending)")
    parser.add_argument("--list-pending", action="store_true", help="List pending icons and exit")
    parser.add_argument("--list-done", action="store_true", help="List already generated icons and exit")
    parser.add_argument("--build-gfx", action="store_true", help="Scan all DDS files and rebuild .gfx, then exit")
    args = parser.parse_args()

    print("=" * 60)
    print("Z-Image Focus Icon Generator (HOI4)")
    print("=" * 60)

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    neg_prompt = args.negative_prompt or NEGATIVE_PROMPT

    print(f"\n[1/5] Parsing focuses.txt...")
    content = FOCUSES_TXT.read_text()
    focus_ids = []
    for line in content.split('\n'):
        for m in re.findall(r'\|\s*((?:BLHM_)?GER_\w+|(?:BLHM_)?SOV_\w+)\s*\|', line):
            fid = m.strip()
            if fid not in focus_ids:
                focus_ids.append(fid)
    print(f"  Found {len(focus_ids)} focus IDs")

    if args.filter:
        focus_ids = [f for f in focus_ids if args.filter.lower() in f.lower()]
        print(f"  After filter: {len(focus_ids)}")

    if args.limit > 0:
        focus_ids = focus_ids[:args.limit]
        print(f"  Limited to: {len(focus_ids)}")

    if args.ids:
        wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
        focus_ids = [f for f in focus_ids if f in wanted]
        print(f"  After explicit IDs: {len(focus_ids)}")

    # Pre-scan: check which icons already exist
    print(f"\n  Scanning for existing icons...")
    already_done = []
    pending = []
    for fid in focus_ids:
        dds_name = f"focus_custom_{fid}.dds"
        if args.variant_suffix:
            dds_name = f"focus_custom_{fid}{args.variant_suffix}.dds"
        # Also check without suffix in case variant was dropped
        alt_name = f"focus_custom_{fid}.dds"
        if (OUTPUT_DIR / dds_name).exists() and not args.force:
            already_done.append(fid)
        elif dds_name != alt_name and (OUTPUT_DIR / alt_name).exists() and not args.force:
            already_done.append(fid)
        else:
            pending.append(fid)
    print(f"  Already generated: {len(already_done)}")
    print(f"  Pending:           {len(pending)}")

    # Apply batch range to pending list
    if args.batch_start > 0:
        pending = pending[args.batch_start:]
        print(f"  After batch-start={args.batch_start}: {len(pending)} pending")

    if args.batch_size > 0:
        pending = pending[:args.batch_size]
        print(f"  After batch-size={args.batch_size}: {len(pending)} to process")

    focus_ids = pending

    if not focus_ids:
        print(f"\n  Nothing to do! All {len(already_done)} icons are already generated.")
        print(f"  Use --force to regenerate or --batch-start/--batch-size for partial runs.")
        return

    if args.list_pending:
        print(f"\n  Pending icons ({len(pending)}):")
        for fid in pending:
            print(f"    {fid}")
        return
    if args.list_done:
        print(f"\n  Already generated ({len(already_done)}):")
        for fid in already_done:
            print(f"    {fid}")
        return

    if args.build_gfx:
        print(f"\n  Scanning OUTPUT_DIR for all DDS files...")
        sprites = []
        for dds_file in sorted(OUTPUT_DIR.glob("focus_custom_*.dds")):
            stem = dds_file.stem
            # Extract focus ID from filename: focus_custom_{fid} or focus_custom_{fid}_suffix
            match = re.match(r"focus_custom_(.+?)(?:_\d+)?$", stem)
            if match:
                fid = match.group(1)
                gfx_name = f"GFX_focus_custom_{fid}"
                sprites.append({"gfx_name": gfx_name, "texturefile": f"gfx/interface/goals/{dds_file.name}"})
        if sprites:
            generate_gfx_file(sprites, OUTPUT_GFX)
            print(f"  Total icons in .gfx: {len(sprites)}")
        else:
            print(f"  No DDS files found in {OUTPUT_DIR}")
        return

    if not args.dry_run:
        print(f"\n[2/5] Checking ComfyUI at {COMFYUI_URL}...")
        if not comfyui_is_running():
            print(f"  [ERROR] ComfyUI not running!")
            sys.exit(1)
        print("  OK!")

    print(f"\n[3/5] Generating icons (size={args.ai_size}x{args.ai_size})...")
    generated = []

    for i, fid in enumerate(focus_ids, 1):
        t0 = time.time()
        print(f"\n{'='*40}")
        print(f"[{i}/{len(focus_ids)}] {fid}")
        print(f"{'='*40}")

        prompt = make_prompt(fid)
        new_gfx = f"GFX_focus_custom_{fid}"
        new_dds_name = f"focus_custom_{fid}.dds"
        if args.variant_suffix:
            new_dds_name = f"focus_custom_{fid}{args.variant_suffix}.dds"
        output_dds = OUTPUT_DIR / new_dds_name

        print(f"  GFX: {new_gfx}")
        print(f"  Output: {new_dds_name}")

        if output_dds.exists() and not args.force:
            size = output_dds.stat().st_size
            print(f"  [SKIP] Already exists ({size} bytes)")
            generated.append({"gfx_name": new_gfx, "texturefile": f"gfx/interface/goals/{new_dds_name}"})
            continue

        print(f"  [PROMPT] {prompt[:80]}...")

        temp_png_output = TEMP_DIR / f"{fid}_output.png"
        temp_rembg = TEMP_DIR / f"{fid}_rembg.png"
        temp_cropped = TEMP_DIR / f"{fid}_cropped.png"
        temp_filled = TEMP_DIR / f"{fid}_filled.png"

        if args.dry_run:
            print(f"  [DRY-RUN] Would send to ComfyUI")
            continue

        # Step 1: Build and queue workflow
        print(f"\n  --- Step 1: Generate image via ComfyUI ---")
        workflow = build_zimage_workflow(
            prompt=prompt,
            negative_prompt=neg_prompt,
            width=args.ai_size,
            height=args.ai_size,
            steps=args.steps,
            cfg=args.cfg,
            seed=args.seed if args.seed else 0,
            unet_name=args.unet,
            clip_name=args.clip,
            vae_name=args.vae,
        )
        if not args.seed:
            workflow["69"]["inputs"]["seed"] = int(time.time() * 1000) % (2**32)

        prompt_id = comfyui_queue_prompt(workflow)
        if not prompt_id:
            print(f"  [ERROR] Failed to queue")
            continue

        images = comfyui_wait_result(prompt_id, timeout=600)
        if not images:
            print(f"  [ERROR] Timeout")
            continue

        if not comfyui_download_image(images[0], temp_png_output):
            continue

        print(f"  [STEP 1 DONE] Generated image: {temp_png_output.name}")

        # Step 2: Remove background
        print(f"\n  --- Step 2: Remove background ---")
        png_current = temp_png_output
        if remove_background_rembg(temp_png_output, temp_rembg):
            png_current = temp_rembg
            print(f"  [STEP 2 DONE] Background removed")
        else:
            print(f"  [WARN] rembg unavailable, skipping background removal")

        # Step 3: Crop transparent margins (at full resolution!)
        print(f"\n  --- Step 3: Crop transparent margins ---")
        if crop_transparent_margins(png_current, temp_cropped):
            png_current = temp_cropped
            print(f"  [STEP 3 DONE] Cropped")
        else:
            print(f"  [WARN] Crop failed, using uncropped image")

        # Step 4: Fill internal alpha holes (at full resolution!)
        print(f"\n  --- Step 4: Fill internal alpha holes ---")
        if fill_internal_alpha_holes(png_current, temp_filled):
            png_current = temp_filled
            print(f"  [STEP 4 DONE] Alpha holes filled")

        # Step 5: Downscale and convert to DDS
        print(f"\n  --- Step 5: Resize and convert to DDS ---")
        if not png_to_dds(png_current, output_dds):
            print(f"  [ERROR] PNG→DDS failed")
            continue

        elapsed = time.time() - t0
        print(f"  [STEP 5 DONE] DDS created in {elapsed:.0f}s total")

        # Preview
        print(f"\n  --- Generating preview ---")
        preview_png = PREVIEW_DIR / f"{Path(new_dds_name).stem}_checker.png"
        make_preview(output_dds, preview_png)

        try:
            report = alpha_report(output_dds)
            print(
                f"  [CHECK] alpha={report['has_alpha']} "
                f"corners={report['transparent_corners']} "
                f"holes={report['internal_holes']} "
                f"transparent={report['transparent_pixels']}"
            )
        except Exception as exc:
            print(f"  [WARN] Alpha check failed: {exc}")

        if preview_png.exists():
            print(f"  [PREVIEW] {preview_png}")
        print(f"  [OK] {output_dds}")

        generated.append({"gfx_name": new_gfx, "texturefile": f"gfx/interface/goals/{new_dds_name}"})

    print(f"\n[4/5] Generating .gfx file...")
    if generated:
        generate_gfx_file(generated, OUTPUT_GFX)
    else:
        print("  No icons generated")

    print(f"\n{'=' * 60}")
    print(f"Done!")
    new_in_run = len(generated)
    if args.dry_run:
        print(f"  Dry-run:             {len(focus_ids)} icons would be generated")
    else:
        failed_in_run = len(focus_ids) - new_in_run
        print(f"  Generated this run:  {new_in_run}")
        print(f"  Failed this run:     {failed_in_run}")
    print(f"  Skipped (existed):   {len(already_done)}")
    total_all = len(already_done) + len(pending)
    total_after = len(already_done) + new_in_run
    print(f"  Total complete:      {total_after} / {total_all}")
    remaining = total_all - total_after
    if remaining > 0 and not args.dry_run:
        print(f"  Remaining:           {remaining} (run again to continue)")
    if generated:
        print(f"  Output:    {OUTPUT_DIR}")
        print(f"  Previews:  {PREVIEW_DIR}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
