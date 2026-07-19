#!/usr/bin/env python3
"""Manage deferred focus and idea icon requests without generating assets during gameplay work."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parent.parent
SHIPPED_ROOT = REPO_ROOT / "BigLeninHistMod"
GENERATOR = REPO_ROOT / "scripts" / "generate-single-focus-icon.py"
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")
FOCUS_BLOCK = re.compile(r"\b(?:focus|shared_focus)\s*=\s*\{")
ASSET_TYPES = ("focus", "idea")

MANIFEST_ROOTS = {
    "focus": REPO_ROOT / "icon-manifests" / "focus",
    "idea": REPO_ROOT / "icon-manifests" / "idea",
}
GENERATED_GFX = {
    "focus": SHIPPED_ROOT / "interface" / "deferred_focus_icons.gfx",
    "idea": SHIPPED_ROOT / "interface" / "deferred_idea_icons.gfx",
}
ASSET_CONFIG = {
    "focus": {
        "sprite_prefix": "GFX_focus_custom_",
        "texture_prefix": "gfx/interface/goals/focus_custom_",
        "fallback_key": "fallback_icon",
        "script_field": "icon",
        "style_preset": "hoi4_focus_v1",
        "size": (100, 88),
    },
    "idea": {
        "sprite_prefix": "GFX_idea_custom_",
        "texture_prefix": "gfx/interface/ideas/idea_custom_",
        "fallback_key": "fallback_picture",
        "script_field": "picture",
        "style_preset": "hoi4_idea_v1",
        "size": (65, 67),
    },
}

STYLE_PROMPTS = {
    "focus": (
        "Create a square national focus icon in the style of a dark World War II grand strategy game. "
        "{subject}. The icon should look like a dark military heraldic medal: a large readable central "
        "symbol inside a heavy bronze and steel medallion, decorated with laurel branches, worn metal, "
        "red enamel, and subtle industrial details. Use a realistic illustrated 1930s-1940s wartime "
        "aesthetic, dramatic lighting, high contrast, dense shadows, and a symmetrical composition. "
        "No text, letters, numbers, UI, or caption. Use a perfectly flat uniform dark-grey background."
    ),
    "idea": (
        "Create a square national idea icon in the style of a dark World War II grand strategy game. "
        "{subject}. Show one large readable central military or political symbol on its own, with clean "
        "edges and no decorative frame, medallion, border, or laurel branches. Use a realistic illustrated "
        "1930s-1940s wartime aesthetic, worn bronze and steel, muted gold, red enamel, dramatic lighting, "
        "high contrast, and dense shadows. No text, letters, numbers, UI, or caption. Use a perfectly flat "
        "uniform dark-grey background."
    ),
}
NEGATIVE_PROMPT = (
    "text, letters, numbers, readable inscriptions, logo, watermark, modern weapons, modern uniforms, "
    "neon colors, anime, cartoon, flat vector art, clean minimal UI, white background, photograph, "
    "blurry, low detail, cropped central object, duplicate symbols"
)


class ManifestError(RuntimeError):
    pass


@dataclass(frozen=True)
class Entry:
    path: Path
    asset_type: str
    asset_id: str
    sprite_name: str
    texturefile: str
    source_file: str
    fallback_reference: str
    prompt: str
    style_preset: str

    @property
    def texture_path(self) -> Path:
        return SHIPPED_ROOT / self.texturefile

    @property
    def source_path(self) -> Path:
        return SHIPPED_ROOT / self.source_file

    @property
    def target_reference(self) -> str:
        if self.asset_type == "focus":
            return self.sprite_name
        return self.sprite_name.removeprefix("GFX_idea_")

    @property
    def size(self) -> tuple[int, int]:
        return ASSET_CONFIG[self.asset_type]["size"]


def expected_sprite(asset_type: str, asset_id: str) -> str:
    return f"{ASSET_CONFIG[asset_type]['sprite_prefix']}{asset_id}"


def expected_texture(asset_type: str, asset_id: str) -> str:
    return f"{ASSET_CONFIG[asset_type]['texture_prefix']}{asset_id}.dds"


def load_entries(asset_type: str | None = None) -> list[Entry]:
    types = (asset_type,) if asset_type else ASSET_TYPES
    entries: list[Entry] = []
    for kind in types:
        root = MANIFEST_ROOTS[kind]
        for path in sorted(root.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise ManifestError(f"{path}: cannot read JSON: {exc}") from exc
            common = (
                "schema_version", "asset_type", "asset_id", "sprite_name", "texturefile",
                "source_file", "prompt", "style_preset",
            )
            missing = [key for key in common if key not in data]
            if missing:
                raise ManifestError(f"{path}: missing fields: {', '.join(missing)}")
            actual_type = data["asset_type"]
            if data["schema_version"] != 1 or actual_type not in ASSET_TYPES:
                raise ManifestError(f"{path}: schema_version=1 and asset_type focus/idea are required")
            if actual_type != kind:
                raise ManifestError(f"{path}: asset_type must match its icon-manifests/{kind}/ directory")
            fallback_key = ASSET_CONFIG[kind]["fallback_key"]
            if fallback_key not in data:
                raise ManifestError(f"{path}: missing field: {fallback_key}")
            entries.append(Entry(
                path=path,
                asset_type=kind,
                asset_id=str(data["asset_id"]),
                sprite_name=str(data["sprite_name"]),
                texturefile=str(data["texturefile"]),
                source_file=str(data["source_file"]),
                fallback_reference=str(data[fallback_key]),
                prompt=str(data["prompt"]),
                style_preset=str(data["style_preset"]),
            ))
    return entries


def matching_brace(text: str, opening: int) -> int:
    depth = 0
    quoted = False
    escaped = False
    comment = False
    for index in range(opening, len(text)):
        char = text[index]
        if comment:
            if char in "\r\n":
                comment = False
            continue
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
            continue
        if char == "#":
            comment = True
        elif char == '"':
            quoted = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
    raise ManifestError("unbalanced script block")


def find_focus_block(text: str, focus_id: str) -> tuple[int, int]:
    id_pattern = re.compile(rf"(?m)^\s*id\s*=\s*\"?{re.escape(focus_id)}\"?\s*(?:#.*)?$")
    matches: list[tuple[int, int]] = []
    for match in FOCUS_BLOCK.finditer(text):
        opening = text.find("{", match.start(), match.end())
        end = matching_brace(text, opening)
        if id_pattern.search(text, match.start(), end):
            matches.append((match.start(), end))
    if len(matches) != 1:
        raise ManifestError(f"expected one focus block for {focus_id}, found {len(matches)}")
    return matches[0]


def find_idea_block(text: str, idea_id: str) -> tuple[int, int]:
    assignment = re.compile(rf"(?m)^[ \t]*{re.escape(idea_id)}[ \t]*=[ \t]*\{{")
    matches: list[tuple[int, int]] = []
    for match in assignment.finditer(text):
        opening = text.find("{", match.start(), match.end())
        matches.append((match.start(), matching_brace(text, opening)))
    if len(matches) != 1:
        raise ManifestError(f"expected one idea block for {idea_id}, found {len(matches)}")
    return matches[0]


def find_asset_block(text: str, entry: Entry) -> tuple[int, int]:
    if entry.asset_type == "focus":
        return find_focus_block(text, entry.asset_id)
    return find_idea_block(text, entry.asset_id)


def current_reference(entry: Entry) -> str:
    if not entry.source_path.exists():
        raise ManifestError(f"{entry.path}: source file does not exist: {entry.source_file}")
    text = entry.source_path.read_text(encoding="utf-8", errors="strict")
    start, end = find_asset_block(text, entry)
    field = ASSET_CONFIG[entry.asset_type]["script_field"]
    match = re.search(rf"(?m)^\s*{field}\s*=\s*([^\s#}}]+)", text[start:end])
    if not match:
        raise ManifestError(f"{entry.path}: {entry.asset_type} {entry.asset_id} has no {field} field")
    return match.group(1).strip('"')


def validate_entries(entries: Iterable[Entry], quiet: bool = False) -> int:
    entries = list(entries)
    errors: list[str] = []
    seen_assets: set[tuple[str, str]] = set()
    seen_sprites: set[str] = set()
    for entry in entries:
        asset_key = (entry.asset_type, entry.asset_id)
        root = MANIFEST_ROOTS[entry.asset_type]
        config = ASSET_CONFIG[entry.asset_type]
        if not SAFE_ID.fullmatch(entry.asset_id):
            errors.append(f"{entry.path}: unsafe asset_id {entry.asset_id!r}")
        if entry.path.parent != root or entry.path.stem != entry.asset_id:
            errors.append(f"{entry.path}: filename must be icon-manifests/{entry.asset_type}/{entry.asset_id}.json")
        if asset_key in seen_assets:
            errors.append(f"{entry.path}: duplicate {entry.asset_type} asset_id {entry.asset_id}")
        if entry.sprite_name in seen_sprites:
            errors.append(f"{entry.path}: duplicate sprite_name {entry.sprite_name}")
        seen_assets.add(asset_key)
        seen_sprites.add(entry.sprite_name)
        expected_gfx = expected_sprite(entry.asset_type, entry.asset_id)
        expected_file = expected_texture(entry.asset_type, entry.asset_id)
        if entry.sprite_name != expected_gfx:
            errors.append(f"{entry.path}: sprite_name must be {expected_gfx}")
        if entry.texturefile != expected_file:
            errors.append(f"{entry.path}: texturefile must be {expected_file}")
        if entry.style_preset != config["style_preset"]:
            errors.append(f"{entry.path}: style_preset must be {config['style_preset']}")
        if len(entry.prompt.strip()) < 20:
            errors.append(f"{entry.path}: prompt is too short; describe a concrete visual subject")
        source = Path(entry.source_file)
        if source.is_absolute() or ".." in source.parts:
            errors.append(f"{entry.path}: source_file must be relative to BigLeninHistMod/")
            continue
        try:
            reference = current_reference(entry)
            if reference not in {entry.fallback_reference, entry.target_reference}:
                errors.append(
                    f"{entry.path}: {config['script_field']} is {reference}, expected fallback "
                    f"{entry.fallback_reference} or generated reference {entry.target_reference}"
                )
            if reference == entry.target_reference and not entry.texture_path.exists():
                errors.append(f"{entry.path}: generated reference is applied but texture is missing")
        except (OSError, UnicodeError, ManifestError) as exc:
            errors.append(str(exc))
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if not quiet:
        counts = {kind: sum(entry.asset_type == kind for entry in entries) for kind in ASSET_TYPES}
        print(f"OK: {len(entries)} manifest entrie(s) (focus={counts['focus']}, idea={counts['idea']})")
    return 0


def selected(entries: list[Entry], ids: str, asset_type: str | None = None) -> list[Entry]:
    if asset_type:
        entries = [entry for entry in entries if entry.asset_type == asset_type]
    if not ids:
        return entries
    wanted = {item.strip() for item in ids.split(",") if item.strip()}
    found = {entry.asset_id for entry in entries}
    missing = sorted(wanted - found)
    if missing:
        suffix = f" for type {asset_type}" if asset_type else ""
        raise ManifestError(f"unknown manifest IDs{suffix}: {', '.join(missing)}")
    return [entry for entry in entries if entry.asset_id in wanted]


def resolve_new_args(args: argparse.Namespace) -> tuple[str, str, str]:
    asset_type = args.asset_type
    asset_id = args.asset_id
    if args.focus_id:
        if asset_type not in (None, "focus") or asset_id:
            raise ManifestError("--focus-id cannot be combined with a different --type or --id")
        asset_type, asset_id = "focus", args.focus_id
    if args.idea_id:
        if asset_type not in (None, "idea") or asset_id:
            raise ManifestError("--idea-id cannot be combined with a different --type or --id")
        asset_type, asset_id = "idea", args.idea_id
    asset_type = asset_type or "focus"
    if not asset_id:
        raise ManifestError("provide --id, --focus-id, or --idea-id")
    fallback = args.fallback
    if args.fallback_icon:
        if asset_type != "focus" or fallback:
            raise ManifestError("--fallback-icon is only for focus manifests and cannot be combined with --fallback")
        fallback = args.fallback_icon
    if args.fallback_picture:
        if asset_type != "idea" or fallback:
            raise ManifestError("--fallback-picture is only for idea manifests and cannot be combined with --fallback")
        fallback = args.fallback_picture
    if not fallback:
        raise ManifestError("provide --fallback, --fallback-icon, or --fallback-picture")
    return asset_type, asset_id, fallback


def command_new(args: argparse.Namespace) -> int:
    asset_type, asset_id, fallback = resolve_new_args(args)
    if not SAFE_ID.fullmatch(asset_id):
        raise ManifestError("asset ID may contain only letters, digits, underscore, dot, and hyphen")
    root = MANIFEST_ROOTS[asset_type]
    path = root / f"{asset_id}.json"
    if path.exists() and not args.force:
        raise ManifestError(f"manifest already exists: {path}")
    previous_content = path.read_bytes() if path.exists() else None
    config = ASSET_CONFIG[asset_type]
    data = {
        "schema_version": 1,
        "asset_type": asset_type,
        "asset_id": asset_id,
        "sprite_name": expected_sprite(asset_type, asset_id),
        "texturefile": expected_texture(asset_type, asset_id),
        "source_file": args.source_file.replace("\\", "/"),
        config["fallback_key"]: fallback,
        "prompt": args.prompt.strip(),
        "style_preset": config["style_preset"],
    }
    root.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result = validate_entries([item for item in load_entries(asset_type) if item.asset_id == asset_id], quiet=True)
    if result:
        if previous_content is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(previous_content)
        return result
    field = config["script_field"]
    print(f"Created {path.relative_to(REPO_ROOT)}")
    print(f"Keep {field} = {fallback} until the generated texture is synchronized.")
    return 0


def entry_state(entry: Entry) -> str:
    try:
        reference = current_reference(entry)
    except ManifestError:
        return "broken"
    if not entry.texture_path.exists():
        return "broken" if reference == entry.target_reference else "pending"
    return "applied" if reference == entry.target_reference else "ready"


def command_status(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids, args.asset_type)
    rows = [
        {"type": entry.asset_type, "id": entry.asset_id, "state": entry_state(entry), "texturefile": entry.texturefile}
        for entry in entries
    ]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for row in rows:
            print(f"{row['state']:<8} {row['type']:<5} {row['id']}")
        counts = {state: sum(row["state"] == state for row in rows) for state in ("pending", "ready", "applied", "broken")}
        print(" ".join(f"{key}={value}" for key, value in counts.items()))
    return 1 if any(row["state"] == "broken" for row in rows) else 0


def command_export(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids, args.asset_type)
    output = Path(args.output)
    if not output.is_absolute():
        output = REPO_ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    records = []
    for entry in entries:
        records.append({
            "id": entry.asset_id,
            "asset_type": entry.asset_type,
            "sprite_name": entry.sprite_name,
            "subject_prompt": entry.prompt,
            "positive_prompt": STYLE_PROMPTS[entry.asset_type].format(subject=entry.prompt.rstrip(".")),
            "negative_prompt": NEGATIVE_PROMPT,
            "width": 512,
            "height": 512,
            "delivery_basename": f"{entry.asset_type}_{entry.asset_id}",
            "expected_dds_width": entry.size[0],
            "expected_dds_height": entry.size[1],
            "expected_texturefile": entry.texturefile,
        })
    if args.format == "json":
        output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        output.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records), encoding="utf-8")
    print(f"Exported {len(records)} request(s) to {output}")
    return 0


def find_delivery(input_dir: Path, entry: Entry) -> Path | None:
    stems = (
        f"{entry.asset_type}_{entry.asset_id}", entry.asset_id, entry.sprite_name, Path(entry.texturefile).stem,
    )
    for stem in stems:
        for suffix in (".dds", ".png", ".webp"):
            candidate = input_dir / f"{stem}{suffix}"
            if candidate.exists():
                return candidate
    return None


def import_image(source: Path, destination: Path, size: tuple[int, int], asset_type: str) -> None:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ManifestError("Pillow is required only for ingest; install it with: pip install Pillow") from exc
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() == ".dds":
        with Image.open(source) as image:
            if image.size != size:
                raise ManifestError(
                    f"{source}: {asset_type} DDS must be {size[0]}x{size[1]}, got {image.size[0]}x{image.size[1]}"
                )
        shutil.copy2(source, destination)
        return
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        if rgba.getchannel("A").getextrema()[0] == 255:
            print(f"WARNING: {source} has no transparent pixels", file=sys.stderr)
        rgba.resize(size, Image.Resampling.LANCZOS).save(destination)


def command_ingest(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids, args.asset_type)
    input_dir = Path(args.input_dir).resolve()
    if not input_dir.is_dir():
        raise ManifestError(f"input directory does not exist: {input_dir}")
    missing = 0
    imported = 0
    for entry in entries:
        source = find_delivery(input_dir, entry)
        if source is None:
            if not entry.texture_path.exists():
                print(f"MISSING: {entry.asset_type} {entry.asset_id}", file=sys.stderr)
                missing += 1
            continue
        if entry.texture_path.exists() and not args.force:
            print(f"SKIP: {entry.asset_type} {entry.asset_id} (texture already exists)")
            continue
        import_image(source, entry.texture_path, entry.size, entry.asset_type)
        print(f"IMPORTED: {source.name} -> {entry.texturefile}")
        imported += 1
    print(f"Imported {imported}; missing {missing}")
    if args.sync and not missing:
        return sync_entries(entries)
    return 1 if missing else 0


def replace_asset_reference(entry: Entry) -> bool:
    text = entry.source_path.read_text(encoding="utf-8")
    start, end = find_asset_block(text, entry)
    block = text[start:end]
    field = ASSET_CONFIG[entry.asset_type]["script_field"]
    pattern = re.compile(rf"(?m)^([ \t]*{field}[ \t]*=[ \t]*)([^\s#}}]+)([^\r\n]*)")
    match = pattern.search(block)
    if not match:
        raise ManifestError(f"{entry.source_file}: {entry.asset_type} {entry.asset_id} has no {field} field")
    old_reference = match.group(2).strip('"')
    if old_reference == entry.target_reference:
        return False
    if old_reference != entry.fallback_reference:
        raise ManifestError(
            f"{entry.source_file}: refusing to replace {old_reference}; manifest fallback is {entry.fallback_reference}"
        )
    replacement = f"{match.group(1)}{entry.target_reference}{match.group(3)}"
    changed_block = block[:match.start()] + replacement + block[match.end():]
    entry.source_path.write_text(text[:start] + changed_block + text[end:], encoding="utf-8")
    return True


def write_generated_gfx(entries: list[Entry], asset_type: str) -> None:
    ready = [entry for entry in entries if entry.asset_type == asset_type and entry.texture_path.exists()]
    lines = [
        "spriteTypes = {",
        f"    #### Generated from icon-manifests/{asset_type}; do not edit by hand ####",
        "",
    ]
    for entry in sorted(ready, key=lambda item: item.sprite_name):
        lines.extend([
            "    SpriteType = {",
            f'        name = "{entry.sprite_name}"',
            f'        texturefile = "{entry.texturefile}"',
            "    }",
            "",
        ])
    lines.extend(["}", ""])
    output = GENERATED_GFX[asset_type]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def sync_entries(entries: list[Entry]) -> int:
    all_entries = load_entries()
    if validate_entries(all_entries, quiet=True):
        return 1
    ready = [entry for entry in entries if entry.texture_path.exists()]
    if not ready:
        print("No generated textures are ready; nothing to synchronize.")
        return 0
    # Generated files always reflect every ready manifest, not only the --ids selection.
    for asset_type in ASSET_TYPES:
        if any(entry.asset_type == asset_type and entry.texture_path.exists() for entry in all_entries):
            write_generated_gfx(all_entries, asset_type)
    changed = 0
    for entry in ready:
        if replace_asset_reference(entry):
            changed += 1
    types = ", ".join(sorted({entry.asset_type for entry in ready}))
    print(f"Synchronized {len(ready)} ready icon(s) ({types}); changed {changed} script reference(s).")
    for asset_type in sorted({entry.asset_type for entry in all_entries if entry.texture_path.exists()}):
        print(f"Generated {GENERATED_GFX[asset_type].relative_to(REPO_ROOT)}")
    return validate_entries(entries, quiet=True)


def command_sync(args: argparse.Namespace) -> int:
    return sync_entries(selected(load_entries(), args.ids, args.asset_type))


def command_generate(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids, args.asset_type)
    pending = [entry for entry in entries if args.force or not entry.texture_path.exists()]
    if args.limit:
        pending = pending[:args.limit]
    if not pending:
        print("No pending icons to generate.")
        return sync_entries(entries) if args.sync else 0
    failed = 0
    for index, entry in enumerate(pending, 1):
        print(f"[{index}/{len(pending)}] Generating {entry.asset_type} {entry.asset_id}")
        command = [
            sys.executable, str(GENERATOR), f"--{entry.asset_type}", "--sprite-name", entry.sprite_name,
            "--desc", entry.prompt, "--no-register-gfx", "--comfyui-url", args.comfyui_url,
            "--steps", str(args.steps), "--cfg", str(args.cfg), "--ai-size", str(args.ai_size),
        ]
        if args.force:
            command.append("--force")
        result = subprocess.run(command, cwd=REPO_ROOT)
        if result.returncode:
            failed += 1
            if args.fail_fast:
                break
    if failed:
        print(f"Generation failed for {failed} icon(s).", file=sys.stderr)
        return 1
    return sync_entries(entries) if args.sync else 0


def add_selector_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--type", dest="asset_type", choices=ASSET_TYPES)
    parser.add_argument("--ids", default="", help="comma-separated IDs; combine with --type if IDs overlap")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    new = subparsers.add_parser("new", help="create one focus or idea manifest with a valid fallback")
    new.add_argument("--type", dest="asset_type", choices=ASSET_TYPES)
    ids = new.add_mutually_exclusive_group()
    ids.add_argument("--id", dest="asset_id")
    ids.add_argument("--focus-id", help="backward-compatible shortcut for --type focus --id")
    ids.add_argument("--idea-id", help="shortcut for --type idea --id")
    new.add_argument("--source-file", required=True, help="path relative to BigLeninHistMod/")
    fallbacks = new.add_mutually_exclusive_group()
    fallbacks.add_argument("--fallback")
    fallbacks.add_argument("--fallback-icon")
    fallbacks.add_argument("--fallback-picture")
    new.add_argument("--prompt", required=True, help="concrete visual subject, not the style boilerplate")
    new.add_argument("--force", action="store_true")
    new.set_defaults(func=command_new)

    validate = subparsers.add_parser("validate", help="validate manifests and their script references")
    validate.add_argument("--type", dest="asset_type", choices=ASSET_TYPES)
    validate.set_defaults(func=lambda args: validate_entries(load_entries(args.asset_type)))

    status = subparsers.add_parser("status", help="show pending, ready, applied, or broken requests")
    add_selector_arguments(status)
    status.add_argument("--json", action="store_true")
    status.set_defaults(func=command_status)

    export = subparsers.add_parser("export", help="export generator-agnostic JSON/JSONL prompts")
    add_selector_arguments(export)
    export.add_argument("--output", default="build/icon-requests.jsonl")
    export.add_argument("--format", choices=("jsonl", "json"), default="jsonl")
    export.set_defaults(func=command_export)

    ingest = subparsers.add_parser("ingest", help="import externally generated PNG/WebP/DDS files")
    ingest.add_argument("--input-dir", required=True)
    add_selector_arguments(ingest)
    ingest.add_argument("--force", action="store_true")
    ingest.add_argument("--sync", action="store_true")
    ingest.set_defaults(func=command_ingest)

    sync = subparsers.add_parser("sync", help="generate GFX and replace fallbacks for ready textures")
    add_selector_arguments(sync)
    sync.set_defaults(func=command_sync)

    generate = subparsers.add_parser("generate", help="batch-generate pending manifests through ComfyUI")
    add_selector_arguments(generate)
    generate.add_argument("--limit", type=int, default=0)
    generate.add_argument("--comfyui-url", default="http://localhost:8188")
    generate.add_argument("--steps", type=int, default=35)
    generate.add_argument("--cfg", type=float, default=4.0)
    generate.add_argument("--ai-size", type=int, default=512)
    generate.add_argument("--force", action="store_true")
    generate.add_argument("--fail-fast", action="store_true")
    generate.add_argument("--sync", action="store_true")
    generate.set_defaults(func=command_generate)
    return parser


def main() -> int:
    try:
        args = build_parser().parse_args()
        return args.func(args)
    except ManifestError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
