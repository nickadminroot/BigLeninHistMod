#!/usr/bin/env python3
"""Manage deferred focus-icon requests without generating assets during focus work."""

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
MANIFEST_ROOT = REPO_ROOT / "icon-manifests" / "focus"
GENERATED_GFX = SHIPPED_ROOT / "interface" / "deferred_focus_icons.gfx"
GENERATOR = REPO_ROOT / "scripts" / "generate-single-focus-icon.py"
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")
FOCUS_BLOCK = re.compile(r"\b(?:focus|shared_focus)\s*=\s*\{")

FOCUS_STYLE_PROMPT = (
    "Create a square national focus icon in the style of a dark World War II grand strategy game. "
    "{subject}. The icon should look like a dark military heraldic medal: a large readable central "
    "symbol inside a heavy bronze and steel medallion, decorated with laurel branches, worn metal, "
    "red enamel, and subtle industrial details. Use a realistic illustrated 1930s-1940s wartime "
    "aesthetic, dramatic lighting, high contrast, dense shadows, and a symmetrical composition. "
    "No text, letters, numbers, UI, or caption. Use a perfectly flat uniform dark-grey background."
)
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
    asset_id: str
    sprite_name: str
    texturefile: str
    source_file: str
    fallback_icon: str
    prompt: str
    style_preset: str

    @property
    def texture_path(self) -> Path:
        return SHIPPED_ROOT / self.texturefile

    @property
    def source_path(self) -> Path:
        return SHIPPED_ROOT / self.source_file


def expected_sprite(asset_id: str) -> str:
    return f"GFX_focus_custom_{asset_id}"


def expected_texture(asset_id: str) -> str:
    return f"gfx/interface/goals/focus_custom_{asset_id}.dds"


def load_entries() -> list[Entry]:
    entries: list[Entry] = []
    for path in sorted(MANIFEST_ROOT.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ManifestError(f"{path}: cannot read JSON: {exc}") from exc
        required = (
            "schema_version", "asset_type", "asset_id", "sprite_name", "texturefile",
            "source_file", "fallback_icon", "prompt", "style_preset",
        )
        missing = [key for key in required if key not in data]
        if missing:
            raise ManifestError(f"{path}: missing fields: {', '.join(missing)}")
        if data["schema_version"] != 1 or data["asset_type"] != "focus":
            raise ManifestError(f"{path}: only schema_version=1 and asset_type=focus are supported")
        entries.append(Entry(path=path, **{key: str(data[key]) for key in required[2:]}))
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
    raise ManifestError("unbalanced focus block")


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


def current_icon(entry: Entry) -> str:
    if not entry.source_path.exists():
        raise ManifestError(f"{entry.path}: source file does not exist: {entry.source_file}")
    text = entry.source_path.read_text(encoding="utf-8", errors="strict")
    start, end = find_focus_block(text, entry.asset_id)
    match = re.search(r"(?m)^\s*icon\s*=\s*([^\s#}]+)", text[start:end])
    if not match:
        raise ManifestError(f"{entry.path}: focus {entry.asset_id} has no icon field")
    return match.group(1).strip('"')


def validate_entries(entries: Iterable[Entry], quiet: bool = False) -> int:
    entries = list(entries)
    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_sprites: set[str] = set()
    for entry in entries:
        if not SAFE_ID.fullmatch(entry.asset_id):
            errors.append(f"{entry.path}: unsafe asset_id {entry.asset_id!r}")
        if entry.path.stem != entry.asset_id:
            errors.append(f"{entry.path}: filename must be {entry.asset_id}.json")
        if entry.asset_id in seen_ids:
            errors.append(f"{entry.path}: duplicate asset_id {entry.asset_id}")
        if entry.sprite_name in seen_sprites:
            errors.append(f"{entry.path}: duplicate sprite_name {entry.sprite_name}")
        seen_ids.add(entry.asset_id)
        seen_sprites.add(entry.sprite_name)
        if entry.sprite_name != expected_sprite(entry.asset_id):
            errors.append(f"{entry.path}: sprite_name must be {expected_sprite(entry.asset_id)}")
        if entry.texturefile != expected_texture(entry.asset_id):
            errors.append(f"{entry.path}: texturefile must be {expected_texture(entry.asset_id)}")
        if entry.style_preset != "hoi4_focus_v1":
            errors.append(f"{entry.path}: unsupported style_preset {entry.style_preset!r}")
        if len(entry.prompt.strip()) < 20:
            errors.append(f"{entry.path}: prompt is too short; describe a concrete visual subject")
        if Path(entry.source_file).is_absolute() or ".." in Path(entry.source_file).parts:
            errors.append(f"{entry.path}: source_file must be relative to BigLeninHistMod/")
            continue
        try:
            icon = current_icon(entry)
            if icon not in {entry.fallback_icon, entry.sprite_name}:
                errors.append(
                    f"{entry.path}: focus icon is {icon}, expected fallback {entry.fallback_icon} "
                    f"or generated sprite {entry.sprite_name}"
                )
            if icon == entry.sprite_name and not entry.texture_path.exists():
                errors.append(f"{entry.path}: generated sprite is applied but texture is missing")
        except (OSError, UnicodeError, ManifestError) as exc:
            errors.append(str(exc))
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if not quiet:
        print(f"OK: {len(entries)} manifest entrie(s)")
    return 0


def selected(entries: list[Entry], ids: str) -> list[Entry]:
    if not ids:
        return entries
    wanted = {item.strip() for item in ids.split(",") if item.strip()}
    found = {entry.asset_id for entry in entries}
    missing = sorted(wanted - found)
    if missing:
        raise ManifestError(f"unknown manifest IDs: {', '.join(missing)}")
    return [entry for entry in entries if entry.asset_id in wanted]


def command_new(args: argparse.Namespace) -> int:
    if not SAFE_ID.fullmatch(args.focus_id):
        raise ManifestError("focus ID may contain only letters, digits, underscore, dot, and hyphen")
    path = MANIFEST_ROOT / f"{args.focus_id}.json"
    if path.exists() and not args.force:
        raise ManifestError(f"manifest already exists: {path}")
    previous_content = path.read_bytes() if path.exists() else None
    data = {
        "schema_version": 1,
        "asset_type": "focus",
        "asset_id": args.focus_id,
        "sprite_name": expected_sprite(args.focus_id),
        "texturefile": expected_texture(args.focus_id),
        "source_file": args.source_file.replace("\\", "/"),
        "fallback_icon": args.fallback_icon,
        "prompt": args.prompt.strip(),
        "style_preset": "hoi4_focus_v1",
    }
    MANIFEST_ROOT.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    entry = load_entries()
    result = validate_entries([item for item in entry if item.asset_id == args.focus_id], quiet=True)
    if result:
        if previous_content is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(previous_content)
        return result
    print(f"Created {path.relative_to(REPO_ROOT)}")
    print(f"Keep icon = {args.fallback_icon} until the generated texture is synchronized.")
    return 0


def entry_state(entry: Entry) -> str:
    try:
        icon = current_icon(entry)
    except ManifestError:
        return "broken"
    if not entry.texture_path.exists():
        return "broken" if icon == entry.sprite_name else "pending"
    return "applied" if icon == entry.sprite_name else "ready"


def command_status(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids)
    rows = [{"id": entry.asset_id, "state": entry_state(entry), "texturefile": entry.texturefile} for entry in entries]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for row in rows:
            print(f"{row['state']:<8} {row['id']}")
        counts = {state: sum(row["state"] == state for row in rows) for state in ("pending", "ready", "applied", "broken")}
        print(" ".join(f"{key}={value}" for key, value in counts.items()))
    return 1 if any(row["state"] == "broken" for row in rows) else 0


def command_export(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids)
    output = Path(args.output)
    if not output.is_absolute():
        output = REPO_ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    records = []
    for entry in entries:
        records.append({
            "id": entry.asset_id,
            "asset_type": "focus",
            "sprite_name": entry.sprite_name,
            "subject_prompt": entry.prompt,
            "positive_prompt": FOCUS_STYLE_PROMPT.format(subject=entry.prompt.rstrip(".")),
            "negative_prompt": NEGATIVE_PROMPT,
            "width": 512,
            "height": 512,
            "delivery_basename": entry.asset_id,
            "expected_texturefile": entry.texturefile,
        })
    if args.format == "json":
        output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        output.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records), encoding="utf-8")
    print(f"Exported {len(records)} request(s) to {output}")
    return 0


def find_delivery(input_dir: Path, entry: Entry) -> Path | None:
    stems = (entry.asset_id, entry.sprite_name, Path(entry.texturefile).stem)
    suffixes = (".dds", ".png", ".webp")
    for stem in stems:
        for suffix in suffixes:
            candidate = input_dir / f"{stem}{suffix}"
            if candidate.exists():
                return candidate
    return None


def import_image(source: Path, destination: Path) -> None:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ManifestError("Pillow is required only for ingest; install it with: pip install Pillow") from exc
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() == ".dds":
        with Image.open(source) as image:
            if image.size != (100, 88):
                raise ManifestError(f"{source}: focus DDS must be 100x88, got {image.size[0]}x{image.size[1]}")
        shutil.copy2(source, destination)
        return
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        if rgba.getchannel("A").getextrema()[0] == 255:
            print(f"WARNING: {source} has no transparent pixels", file=sys.stderr)
        resized = rgba.resize((100, 88), Image.Resampling.LANCZOS)
        resized.save(destination)


def command_ingest(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids)
    input_dir = Path(args.input_dir).resolve()
    if not input_dir.is_dir():
        raise ManifestError(f"input directory does not exist: {input_dir}")
    missing = 0
    imported = 0
    for entry in entries:
        source = find_delivery(input_dir, entry)
        if source is None:
            if not entry.texture_path.exists():
                print(f"MISSING: {entry.asset_id}", file=sys.stderr)
                missing += 1
            continue
        if entry.texture_path.exists() and not args.force:
            print(f"SKIP: {entry.asset_id} (texture already exists)")
            continue
        import_image(source, entry.texture_path)
        print(f"IMPORTED: {source.name} -> {entry.texturefile}")
        imported += 1
    print(f"Imported {imported}; missing {missing}")
    if args.sync and not missing:
        return sync_entries(entries)
    return 1 if missing else 0


def replace_focus_icon(entry: Entry) -> bool:
    text = entry.source_path.read_text(encoding="utf-8")
    start, end = find_focus_block(text, entry.asset_id)
    block = text[start:end]
    pattern = re.compile(r"(?m)^([ \t]*icon[ \t]*=[ \t]*)([^\s#}]+)([^\r\n]*)")
    match = pattern.search(block)
    if not match:
        raise ManifestError(f"{entry.source_file}: focus {entry.asset_id} has no icon field")
    old_icon = match.group(2).strip('"')
    if old_icon == entry.sprite_name:
        return False
    if old_icon != entry.fallback_icon:
        raise ManifestError(
            f"{entry.source_file}: refusing to replace {old_icon}; manifest fallback is {entry.fallback_icon}"
        )
    replacement = f"{match.group(1)}{entry.sprite_name}{match.group(3)}"
    changed_block = block[:match.start()] + replacement + block[match.end():]
    entry.source_path.write_text(text[:start] + changed_block + text[end:], encoding="utf-8")
    return True


def write_generated_gfx(entries: list[Entry]) -> None:
    ready = [entry for entry in entries if entry.texture_path.exists()]
    lines = ["spriteTypes = {", "    #### Generated from icon-manifests/focus; do not edit by hand ####", ""]
    for entry in sorted(ready, key=lambda item: item.sprite_name):
        lines.extend([
            "    SpriteType = {",
            f'        name = "{entry.sprite_name}"',
            f'        texturefile = "{entry.texturefile}"',
            "    }",
            "",
        ])
    lines.extend(["}", ""])
    GENERATED_GFX.parent.mkdir(parents=True, exist_ok=True)
    GENERATED_GFX.write_text("\n".join(lines), encoding="utf-8")


def sync_entries(entries: list[Entry]) -> int:
    all_entries = load_entries()
    if validate_entries(all_entries, quiet=True):
        return 1
    ready = [entry for entry in entries if entry.texture_path.exists()]
    if not ready:
        print("No generated textures are ready; nothing to synchronize.")
        return 0
    # The GFX file always reflects every ready manifest, not only --ids selection.
    write_generated_gfx(all_entries)
    changed = 0
    for entry in ready:
        if replace_focus_icon(entry):
            changed += 1
    print(f"Synchronized {len(ready)} ready icon(s); changed {changed} focus reference(s).")
    print(f"Generated {GENERATED_GFX.relative_to(REPO_ROOT)}")
    return validate_entries(entries, quiet=True)


def command_sync(args: argparse.Namespace) -> int:
    return sync_entries(selected(load_entries(), args.ids))


def command_generate(args: argparse.Namespace) -> int:
    entries = selected(load_entries(), args.ids)
    pending = [entry for entry in entries if args.force or not entry.texture_path.exists()]
    if args.limit:
        pending = pending[:args.limit]
    if not pending:
        print("No pending icons to generate.")
        return sync_entries(entries) if args.sync else 0
    failed = 0
    for index, entry in enumerate(pending, 1):
        print(f"[{index}/{len(pending)}] Generating {entry.asset_id}")
        command = [
            sys.executable, str(GENERATOR), "--focus", "--sprite-name", entry.sprite_name,
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    new = subparsers.add_parser("new", help="create one manifest after adding a focus with a fallback icon")
    new.add_argument("--focus-id", required=True)
    new.add_argument("--source-file", required=True, help="path relative to BigLeninHistMod/")
    new.add_argument("--fallback-icon", required=True)
    new.add_argument("--prompt", required=True, help="concrete visual subject, not the style boilerplate")
    new.add_argument("--force", action="store_true")
    new.set_defaults(func=command_new)

    validate = subparsers.add_parser("validate", help="validate all manifests and their focus references")
    validate.set_defaults(func=lambda _args: validate_entries(load_entries()))

    status = subparsers.add_parser("status", help="show pending, ready, applied, or broken requests")
    status.add_argument("--ids", default="")
    status.add_argument("--json", action="store_true")
    status.set_defaults(func=command_status)

    export = subparsers.add_parser("export", help="export generator-agnostic JSON/JSONL prompts")
    export.add_argument("--ids", default="")
    export.add_argument("--output", default="build/icon-requests.jsonl")
    export.add_argument("--format", choices=("jsonl", "json"), default="jsonl")
    export.set_defaults(func=command_export)

    ingest = subparsers.add_parser("ingest", help="import externally generated PNG/WebP/DDS files")
    ingest.add_argument("--input-dir", required=True)
    ingest.add_argument("--ids", default="")
    ingest.add_argument("--force", action="store_true")
    ingest.add_argument("--sync", action="store_true")
    ingest.set_defaults(func=command_ingest)

    sync = subparsers.add_parser("sync", help="generate GFX and replace fallback icons for ready textures")
    sync.add_argument("--ids", default="")
    sync.set_defaults(func=command_sync)

    generate = subparsers.add_parser("generate", help="batch-generate pending manifests through ComfyUI")
    generate.add_argument("--ids", default="")
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
