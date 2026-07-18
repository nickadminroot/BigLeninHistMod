#!/usr/bin/env python3
"""Apply a captured semantic HOI4 map patch onto a clean target vanilla map."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

ID_RE = re.compile(r"^\s*id\s*=\s*(\d+)\b", re.MULTILINE)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def definition_rows(path: Path) -> dict[int, list[str]]:
    rows: dict[int, list[str]] = {}
    with path.open("r", encoding="utf-8-sig", errors="strict", newline="") as handle:
        for row in csv.reader(handle, delimiter=";"):
            if row and row[0].strip().isdigit():
                rows[int(row[0])] = row
    return rows


def indexed_files(root: Path) -> dict[int, Path]:
    result: dict[int, Path] = {}
    for path in sorted(root.glob("*.txt")):
        text = path.read_text(encoding="utf-8-sig", errors="strict")
        match = ID_RE.search(text)
        if not match:
            continue
        item_id = int(match.group(1))
        if item_id in result:
            raise RuntimeError(f"duplicate id {item_id}: {result[item_id]} and {path}")
        result[item_id] = path
    return result


def replace_numeric_tokens(text: str, mapping: dict[int, int]) -> str:
    if not mapping:
        return text
    pattern = re.compile(r"(?<![A-Za-z0-9_.])(" + "|".join(map(str, sorted(mapping, key=lambda value: (-len(str(value)), value)))) + r")(?![A-Za-z0-9_.])")
    return pattern.sub(lambda match: str(mapping[int(match.group(1))]), text)


def preserve_newlines(source: bytes, text: str) -> bytes:
    bom = b"\xef\xbb\xbf" if source.startswith(b"\xef\xbb\xbf") else b""
    newline = "\r\n" if source.count(b"\r\n") == source.count(b"\n") and source.count(b"\n") else "\n"
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return bom + normalized.replace("\n", newline).encode("utf-8")


def state_provinces(text: str) -> set[int]:
    match = re.search(r"\bprovinces\s*=\s*\{([^}]*)\}", text, re.DOTALL)
    if not match:
        return set()
    return {int(token) for token in re.findall(r"\b\d+\b", match.group(1))}


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            shutil.copystat(path, temp_name)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def save_bmp_atomic(path: Path, pixels: np.ndarray) -> None:
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".bmp", dir=path.parent)
    os.close(fd)
    try:
        Image.fromarray(pixels, mode="RGB").save(temp_name, format="BMP")
        with open(temp_name, "rb+") as handle:
            os.fsync(handle.fileno())
        shutil.copystat(path, temp_name)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def build_definition(source: bytes, current_rows: dict[int, list[str]], added_rows: list[list[str]]) -> bytes:
    newline = b"\r\n" if source.count(b"\r\n") == source.count(b"\n") and source.count(b"\n") else b"\n"
    output = source
    if output and not output.endswith((b"\n", b"\r")):
        output += newline
    for row in added_rows:
        if int(row[0]) in current_rows:
            raise RuntimeError(f"target province id already exists: {row[0]}")
        output += ";".join(row).encode("utf-8") + newline
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patch", type=Path, required=True)
    parser.add_argument("--mod", type=Path, default=Path("BigLeninHistMod"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    patch = args.patch.resolve()
    mod = args.mod.resolve()
    config = json.loads((patch / "remap-july-1.19.2.json").read_text(encoding="utf-8"))
    pixel_delta = json.loads((patch / "province-pixel-delta.json").read_text(encoding="utf-8"))
    definition_delta = json.loads((patch / "definition-delta.json").read_text(encoding="utf-8"))

    province_map = {int(old): int(new) for old, new in config["provinceIdMap"].items()}
    province_colors = {int(item_id): tuple(map(int, color)) for item_id, color in config["provinceColors"].items()}
    region_map = {int(old): int(new) for old, new in config["strategicRegionIdMap"].items()}

    definition_path = mod / "map" / "definition.csv"
    bmp_path = mod / "map" / "provinces.bmp"
    if sha256(definition_path) != config["targetDefinitionSha256"]:
        raise RuntimeError("definition.csv is not the expected clean July vanilla baseline")
    if sha256(bmp_path) != config["targetProvincesBmpSha256"]:
        raise RuntimeError("provinces.bmp is not the expected clean July vanilla baseline")

    current_rows = definition_rows(definition_path)
    used_colors = {(int(row[1]), int(row[2]), int(row[3])) for row in current_rows.values()}
    if len(set(province_map.values())) != len(province_map):
        raise RuntimeError("duplicate target province IDs")
    if len(set(province_colors.values())) != len(province_colors):
        raise RuntimeError("duplicate target province colors")
    for target_id in province_map.values():
        if target_id in current_rows:
            raise RuntimeError(f"target province ID already exists: {target_id}")
        if target_id not in province_colors:
            raise RuntimeError(f"missing target color for province {target_id}")
        if province_colors[target_id] in used_colors:
            raise RuntimeError(f"target province color already exists: {target_id} {province_colors[target_id]}")

    source_added = {int(item["id"]): item["row"] for item in definition_delta["added"]}
    added_rows = []
    for old_id, new_id in sorted(province_map.items(), key=lambda item: item[1]):
        old_row = source_added[old_id]
        color = province_colors[new_id]
        added_rows.append([str(new_id), str(color[0]), str(color[1]), str(color[2]), *old_row[4:]])

    current_color_by_id = {item_id: tuple(map(int, row[1:4])) for item_id, row in current_rows.items()}
    with Image.open(bmp_path) as image:
        pixels = np.array(image.convert("RGB"))
    changed_pixels = 0
    for transition in pixel_delta["transitions"]:
        base_id = transition.get("baseProvinceId")
        source_target_id = transition.get("modProvinceId")
        if base_id not in current_color_by_id:
            raise RuntimeError(f"base province ID missing in July target: {base_id}")
        target_id = province_map.get(source_target_id, source_target_id)
        if target_id in province_colors:
            target_color = province_colors[target_id]
        elif target_id in current_color_by_id:
            target_color = current_color_by_id[target_id]
        else:
            raise RuntimeError(f"transition target province ID missing: {target_id}")
        expected = np.asarray(current_color_by_id[base_id], dtype=np.uint8)
        replacement = np.asarray(target_color, dtype=np.uint8)
        for y, x1, x2 in transition["rowRuns"]:
            segment = pixels[y, x1 : x2 + 1]
            mismatch = np.any(segment != expected, axis=1)
            if mismatch.any():
                raise RuntimeError(
                    f"pixel precondition mismatch for base province {base_id} at y={y}, x={x1}..{x2}: {int(mismatch.sum())} pixels"
                )
            pixels[y, x1 : x2 + 1] = replacement
            changed_pixels += x2 - x1 + 1
    if changed_pixels != pixel_delta["changedPixelCount"]:
        raise RuntimeError(f"changed pixel count mismatch: {changed_pixels} != {pixel_delta['changedPixelCount']}")

    for old_id, new_id in province_map.items():
        expected_count = next(item["pixelCount"] for item in pixel_delta["addedProvinces"] if int(item["id"]) == old_id)
        actual_count = int(np.all(pixels == np.asarray(province_colors[new_id], dtype=np.uint8), axis=2).sum())
        if actual_count != expected_count:
            raise RuntimeError(f"province {new_id} pixel count mismatch: {actual_count} != {expected_count}")

    definition_bytes = build_definition(definition_path.read_bytes(), current_rows, added_rows)

    writes: dict[Path, bytes] = {definition_path: definition_bytes}
    source_states = indexed_files(patch / "files" / "history" / "states")
    target_states = indexed_files(mod / "history" / "states")
    current_province_to_state: dict[int, int] = {}
    target_province_to_state: dict[int, int] = {}
    for state_id, target_path in target_states.items():
        for province_id in state_provinces(target_path.read_text(encoding="utf-8-sig")):
            current_province_to_state[province_id] = state_id
            target_province_to_state[province_id] = state_id
    for state_id in config["affectedStateIds"]:
        source_path = source_states[int(state_id)]
        target_path = target_states[int(state_id)]
        text = replace_numeric_tokens(source_path.read_text(encoding="utf-8-sig"), province_map)
        for province_id, owner_state in list(target_province_to_state.items()):
            if owner_state == int(state_id):
                del target_province_to_state[province_id]
        for province_id in state_provinces(text):
            target_province_to_state[province_id] = int(state_id)
        writes[target_path] = preserve_newlines(target_path.read_bytes(), text)

    moved_provinces = {
        province_id
        for province_id, target_state in target_province_to_state.items()
        if current_province_to_state.get(province_id) != target_state
    }
    color_to_province = {color: province_id for province_id, color in current_color_by_id.items()}
    color_to_province.update({color: province_id for province_id, color in province_colors.items()})
    buildings_path = mod / "map" / "buildings.txt"
    buildings_source = buildings_path.read_bytes()
    buildings_text = buildings_source.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    buildings_had_final_newline = buildings_text.endswith("\n")
    buildings_lines = buildings_text.splitlines()
    building_reassignments = []
    for line_number, line in enumerate(buildings_lines, 1):
        fields = line.split(";")
        if len(fields) < 7:
            continue
        try:
            source_state = int(fields[0])
            x = round(float(fields[2]))
            bitmap_y = pixels.shape[0] - 1 - round(float(fields[4]))
        except ValueError:
            continue
        if not (0 <= x < pixels.shape[1] and 0 <= bitmap_y < pixels.shape[0]):
            continue
        province_id = color_to_province.get(tuple(map(int, pixels[bitmap_y, x])))
        if province_id not in moved_provinces:
            continue
        target_state = target_province_to_state[province_id]
        if source_state == target_state:
            continue
        fields[0] = str(target_state)
        buildings_lines[line_number - 1] = ";".join(fields)
        building_reassignments.append(
            {"line": line_number, "province": province_id, "fromState": source_state, "toState": target_state, "type": fields[1]}
        )
    updated_buildings = "\n".join(buildings_lines) + ("\n" if buildings_had_final_newline else "")
    writes[buildings_path] = preserve_newlines(buildings_source, updated_buildings)

    adjacency_path = mod / "map" / "adjacencies.csv"
    adjacency_source = adjacency_path.read_bytes()
    adjacency_text = adjacency_source.decode("utf-8-sig")
    oresund_row = "2455;2506;;-1;-1;-1;-1;-1;DANISH_BELTS_STRAIT;Øresund"
    if oresund_row not in adjacency_text:
        sentinel = "-1;-1;;-1;-1;-1;-1;-1;-1"
        if sentinel not in adjacency_text:
            raise RuntimeError("adjacencies.csv sentinel row not found")
        adjacency_text = adjacency_text.replace(sentinel, oresund_row + "\n" + sentinel, 1)
        writes[adjacency_path] = preserve_newlines(adjacency_source, adjacency_text)

    rules_path = mod / "map" / "adjacency_rules.txt"
    rules_source = rules_path.read_bytes()
    rules_text = rules_source.decode("utf-8-sig")
    rule_pattern = re.compile(r'(name\s*=\s*"DANISH_BELTS_STRAIT".*?\bicon\s*=\s*)2431\b', re.DOTALL)
    rules_updated, rule_count = rule_pattern.subn(r"\g<1>2455", rules_text, count=1)
    if rule_count != 1:
        raise RuntimeError("DANISH_BELTS_STRAIT icon precondition not met")
    writes[rules_path] = preserve_newlines(rules_source, rules_updated)

    source_regions = indexed_files(patch / "files" / "map" / "strategicregions")
    target_regions = indexed_files(mod / "map" / "strategicregions")
    for region_id in config["affectedExistingStrategicRegionIds"]:
        source_path = source_regions[int(region_id)]
        target_path = target_regions[int(region_id)]
        text = replace_numeric_tokens(source_path.read_text(encoding="utf-8-sig"), province_map)
        writes[target_path] = preserve_newlines(target_path.read_bytes(), text)
    for old_id, new_id in region_map.items():
        if new_id in target_regions:
            raise RuntimeError(f"target strategic region ID already exists: {new_id}")
        source_path = source_regions[old_id]
        suffix = source_path.name.split("-", 1)[1] if "-" in source_path.name else f"Region {new_id}.txt"
        target_path = mod / "map" / "strategicregions" / f"{new_id}-{suffix}"
        text = replace_numeric_tokens(source_path.read_text(encoding="utf-8-sig"), {**province_map, **region_map})
        writes[target_path] = preserve_newlines(source_path.read_bytes(), text)

    localization_changes = []
    for path in sorted((mod / "localisation").rglob("*.yml")):
        source = path.read_bytes()
        text = source.decode("utf-8-sig")
        updated = text
        for old_id, new_id in region_map.items():
            updated = re.sub(rf"(?m)^(\s*)STRATEGICREGION_{old_id}(:\d+\s+)", rf"\1STRATEGICREGION_{new_id}\2", updated)
        if updated != text:
            writes[path] = preserve_newlines(source, updated)
            localization_changes.append(path.relative_to(mod).as_posix())

    report: dict[str, Any] = {
        "apply": args.apply,
        "changedPixels": changed_pixels,
        "provinceIdMap": province_map,
        "provinceColors": {str(key): list(value) for key, value in province_colors.items()},
        "strategicRegionIdMap": region_map,
        "stateFiles": len(config["affectedStateIds"]),
        "existingStrategicRegionFiles": len(config["affectedExistingStrategicRegionIds"]),
        "newStrategicRegionFiles": len(region_map),
        "movedProvinces": sorted(moved_provinces),
        "buildingReassignments": building_reassignments,
        "localizationFiles": localization_changes,
        "textWrites": [path.relative_to(mod).as_posix() for path in sorted(writes) if path != definition_path],
    }
    if args.apply:
        save_bmp_atomic(bmp_path, pixels)
        for path, data in writes.items():
            write_atomic(path, data)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
