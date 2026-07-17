#!/usr/bin/env python3
"""Capture a reproducible semantic HOI4 map delta before rebasing the map.

The output is intentionally not a Git diff. It contains raw source snapshots,
province pixel runs, definition rows, state/strategic-region topology changes,
and exact numeric-reference evidence for later ID remapping.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

try:
    import numpy as np
    from PIL import Image
except ImportError as error:  # pragma: no cover - environment diagnostic
    raise SystemExit(f"capture-map-delta requires Pillow and numpy: {error}")

ID_RE = re.compile(r"^\s*id\s*=\s*(\d+)\b", re.MULTILINE)
PROVINCES_RE = re.compile(r"\bprovinces\s*=\s*\{([^}]*)\}", re.DOTALL)
NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_.])(\d+)(?![A-Za-z0-9_.])")
TEXT_SUFFIXES = {".txt", ".yml", ".yaml", ".csv", ".map", ".gui", ".gfx", ".asset", ".mod"}
SNAPSHOT_MAP_FILES = {
    "definition.csv",
    "provinces.bmp",
    "adjacencies.csv",
    "adjacency_rules.txt",
    "buildings.txt",
    "positions.txt",
    "railways.txt",
    "supply_nodes.txt",
    "unitstacks.txt",
    "default.map",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig", errors="replace")


def definition_rows(path: Path) -> dict[int, list[str]]:
    rows: dict[int, list[str]] = {}
    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        for row in csv.reader(handle, delimiter=";"):
            if row and row[0].strip().isdigit():
                rows[int(row[0])] = row
    return rows


def indexed_scripts(root: Path) -> dict[int, dict[str, Any]]:
    records: dict[int, dict[str, Any]] = {}
    for path in sorted(root.glob("*.txt")):
        text = read_text(path)
        match = ID_RE.search(text)
        if not match:
            continue
        item_id = int(match.group(1))
        if item_id in records:
            raise RuntimeError(f"duplicate id {item_id}: {records[item_id]['path']} and {path}")
        province_match = PROVINCES_RE.search(text)
        provinces = sorted({int(value) for value in re.findall(r"\b\d+\b", province_match.group(1))}) if province_match else []
        records[item_id] = {
            "path": path,
            "relativePath": path.name,
            "sha256": sha256(path),
            "provinces": provinces,
            "lineCount": len(text.splitlines()),
        }
    return records


def topology_delta(base: dict[int, dict[str, Any]], mod: dict[int, dict[str, Any]]) -> dict[str, Any]:
    common = sorted(base.keys() & mod.keys())
    membership = []
    text_changed = []
    for item_id in common:
        base_item = base[item_id]
        mod_item = mod[item_id]
        if base_item["sha256"] != mod_item["sha256"]:
            text_changed.append(item_id)
        base_provinces = set(base_item["provinces"])
        mod_provinces = set(mod_item["provinces"])
        if base_provinces != mod_provinces:
            membership.append(
                {
                    "id": item_id,
                    "baseFile": base_item["relativePath"],
                    "modFile": mod_item["relativePath"],
                    "addedProvinces": sorted(mod_provinces - base_provinces),
                    "removedProvinces": sorted(base_provinces - mod_provinces),
                    "baseProvinceCount": len(base_provinces),
                    "modProvinceCount": len(mod_provinces),
                }
            )
    return {
        "baseCount": len(base),
        "modCount": len(mod),
        "addedIds": sorted(mod.keys() - base.keys()),
        "removedIds": sorted(base.keys() - mod.keys()),
        "textChangedIds": text_changed,
        "provinceMembershipChanges": membership,
    }


def rgb(row: list[str]) -> tuple[int, int, int]:
    return int(row[1]), int(row[2]), int(row[3])


def row_runs(mask: np.ndarray) -> list[list[int]]:
    runs: list[list[int]] = []
    for y in np.flatnonzero(mask.any(axis=1)):
        xs = np.flatnonzero(mask[y])
        if xs.size == 0:
            continue
        start = previous = int(xs[0])
        for raw_x in xs[1:]:
            x = int(raw_x)
            if x != previous + 1:
                runs.append([int(y), start, previous])
                start = x
            previous = x
        runs.append([int(y), start, previous])
    return runs


def province_pixel_delta(base_bmp: Path, mod_bmp: Path, base_rows: dict[int, list[str]], mod_rows: dict[int, list[str]]) -> dict[str, Any]:
    with Image.open(base_bmp) as base_image, Image.open(mod_bmp) as mod_image:
        base_rgb = np.asarray(base_image.convert("RGB"))
        mod_rgb = np.asarray(mod_image.convert("RGB"))
    if base_rgb.shape != mod_rgb.shape:
        raise RuntimeError(f"province bitmap dimensions differ: {base_rgb.shape} != {mod_rgb.shape}")

    changed = np.any(base_rgb != mod_rgb, axis=2)
    changed_y, changed_x = np.nonzero(changed)
    base_color_ids = {rgb(row): province_id for province_id, row in base_rows.items()}
    mod_color_ids = {rgb(row): province_id for province_id, row in mod_rows.items()}
    transitions: Counter[tuple[tuple[int, int, int], tuple[int, int, int]]] = Counter()
    for old_value, new_value in zip(base_rgb[changed], mod_rgb[changed], strict=True):
        transitions[(tuple(map(int, old_value)), tuple(map(int, new_value)))] += 1

    transition_records = []
    reconstructed = base_rgb.copy()
    for (old_color, new_color), count in sorted(transitions.items(), key=lambda item: (-item[1], item[0])):
        old_array = np.asarray(old_color, dtype=np.uint8)
        new_array = np.asarray(new_color, dtype=np.uint8)
        mask = changed & np.all(base_rgb == old_array, axis=2) & np.all(mod_rgb == new_array, axis=2)
        ys, xs = np.nonzero(mask)
        reconstructed[mask] = new_array
        transition_records.append(
            {
                "baseRgb": list(old_color),
                "baseProvinceId": base_color_ids.get(old_color),
                "modRgb": list(new_color),
                "modProvinceId": mod_color_ids.get(new_color),
                "pixels": count,
                "boundingBox": None
                if xs.size == 0
                else {"x": int(xs.min()), "y": int(ys.min()), "width": int(xs.max() - xs.min() + 1), "height": int(ys.max() - ys.min() + 1)},
                "rowRuns": row_runs(mask),
            }
        )
    reconstruction_matches = bool(np.array_equal(reconstructed, mod_rgb))
    if not reconstruction_matches:
        raise RuntimeError("pixel transition runs do not exactly reconstruct mod provinces.bmp")

    added_ids = sorted(mod_rows.keys() - base_rows.keys())
    added_provinces = []
    for province_id in added_ids:
        color = rgb(mod_rows[province_id])
        mask = np.all(mod_rgb == color, axis=2)
        ys, xs = np.nonzero(mask)
        overwritten: Counter[tuple[int, int, int]] = Counter(tuple(map(int, value)) for value in base_rgb[mask])
        added_provinces.append(
            {
                "id": province_id,
                "definitionRow": mod_rows[province_id],
                "rgb": list(color),
                "pixelCount": int(mask.sum()),
                "boundingBox": None
                if xs.size == 0
                else {"x": int(xs.min()), "y": int(ys.min()), "width": int(xs.max() - xs.min() + 1), "height": int(ys.max() - ys.min() + 1)},
                "baseColorsOverwritten": [
                    {"rgb": list(old_color), "baseProvinceId": base_color_ids.get(old_color), "pixels": count}
                    for old_color, count in sorted(overwritten.items(), key=lambda item: (-item[1], item[0]))
                ],
                "rowRuns": row_runs(mask),
            }
        )

    return {
        "width": int(base_rgb.shape[1]),
        "height": int(base_rgb.shape[0]),
        "changedPixelCount": int(changed.sum()),
        "changedBoundingBox": None
        if changed_x.size == 0
        else {
            "x": int(changed_x.min()),
            "y": int(changed_y.min()),
            "width": int(changed_x.max() - changed_x.min() + 1),
            "height": int(changed_y.max() - changed_y.min() + 1),
        },
        "transitions": transition_records,
        "verification": {
            "transitionPixels": sum(item["pixels"] for item in transition_records),
            "transitionsReconstructModBitmap": reconstruction_matches,
        },
        "addedProvinces": added_provinces,
    }


def copy_snapshot(source: Path, target: Path) -> list[dict[str, Any]]:
    copied: list[dict[str, Any]] = []
    candidates = [source / "map" / name for name in SNAPSHOT_MAP_FILES]
    candidates += sorted((source / "map" / "strategicregions").glob("*.txt"))
    candidates += sorted((source / "history" / "states").glob("*.txt"))
    for path in candidates:
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        copied.append({"path": relative.as_posix(), "size": path.stat().st_size, "sha256": sha256(path)})
    return copied


def scan_references(mod: Path, tracked: dict[str, set[int]]) -> list[dict[str, Any]]:
    all_ids = set().union(*tracked.values())
    references = []
    for path in sorted(mod.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        relative = path.relative_to(mod).as_posix()
        for line_number, line in enumerate(read_text(path).splitlines(), 1):
            found = {int(value) for value in NUMBER_RE.findall(line)} & all_ids
            if not found:
                continue
            references.append(
                {
                    "path": relative,
                    "line": line_number,
                    "text": line.strip(),
                    "ids": [
                        {"id": value, "kinds": sorted(kind for kind, values in tracked.items() if value in values)}
                        for value in sorted(found)
                    ],
                }
            )
    return references


def git_head() -> str | None:
    result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=Path("vanilla"), help="May vanilla snapshot")
    parser.add_argument("--mod", type=Path, default=Path("BigLeninHistMod"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    base = args.base.resolve()
    mod = args.mod.resolve()
    output = args.output.resolve()
    for required in (base / "map" / "provinces.bmp", base / "map" / "definition.csv", mod / "map" / "provinces.bmp", mod / "map" / "definition.csv"):
        if not required.is_file():
            print(f"missing required input: {required}", file=sys.stderr)
            return 2
    if output.exists():
        if not args.overwrite:
            print(f"output already exists: {output}", file=sys.stderr)
            return 2
        shutil.rmtree(output)
    output.mkdir(parents=True)

    base_definitions = definition_rows(base / "map" / "definition.csv")
    mod_definitions = definition_rows(mod / "map" / "definition.csv")
    base_states = indexed_scripts(base / "history" / "states")
    mod_states = indexed_scripts(mod / "history" / "states")
    base_regions = indexed_scripts(base / "map" / "strategicregions")
    mod_regions = indexed_scripts(mod / "map" / "strategicregions")

    definition_delta = {
        "baseCount": len(base_definitions),
        "modCount": len(mod_definitions),
        "added": [{"id": item_id, "row": mod_definitions[item_id]} for item_id in sorted(mod_definitions.keys() - base_definitions.keys())],
        "removed": [{"id": item_id, "row": base_definitions[item_id]} for item_id in sorted(base_definitions.keys() - mod_definitions.keys())],
        "changed": [
            {"id": item_id, "baseRow": base_definitions[item_id], "modRow": mod_definitions[item_id]}
            for item_id in sorted(base_definitions.keys() & mod_definitions.keys())
            if base_definitions[item_id] != mod_definitions[item_id]
        ],
    }
    state_delta = topology_delta(base_states, mod_states)
    region_delta = topology_delta(base_regions, mod_regions)
    pixel_delta = province_pixel_delta(base / "map" / "provinces.bmp", mod / "map" / "provinces.bmp", base_definitions, mod_definitions)
    state_by_province = {
        province_id: state_id
        for state_id, item in mod_states.items()
        for province_id in item["provinces"]
    }
    region_by_province = {
        province_id: region_id
        for region_id, item in mod_regions.items()
        for province_id in item["provinces"]
    }
    for item in pixel_delta["addedProvinces"]:
        item["stateId"] = state_by_province.get(item["id"])
        item["strategicRegionId"] = region_by_province.get(item["id"])

    tracked = {
        "customProvince": {item["id"] for item in definition_delta["added"]},
        "changedState": {item["id"] for item in state_delta["provinceMembershipChanges"]},
        "customStrategicRegion": set(region_delta["addedIds"]),
        "changedStrategicRegion": {item["id"] for item in region_delta["provinceMembershipChanges"]},
    }
    references = scan_references(mod, tracked)

    (output / "definition-delta.json").write_text(json.dumps(definition_delta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "province-pixel-delta.json").write_text(json.dumps(pixel_delta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "state-topology-delta.json").write_text(json.dumps(state_delta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "strategic-region-topology-delta.json").write_text(json.dumps(region_delta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "id-references.json").write_text(json.dumps(references, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    base_snapshot = copy_snapshot(base, output / "snapshot" / "base")
    mod_snapshot = copy_snapshot(mod, output / "snapshot" / "mod")
    manifest = {
        "schemaVersion": 1,
        "gitHead": git_head(),
        "base": base.as_posix(),
        "mod": mod.as_posix(),
        "definitionDelta": "definition-delta.json",
        "provincePixelDelta": "province-pixel-delta.json",
        "stateTopologyDelta": "state-topology-delta.json",
        "strategicRegionTopologyDelta": "strategic-region-topology-delta.json",
        "idReferences": "id-references.json",
        "summary": {
            "baseProvinces": len(base_definitions),
            "modProvinces": len(mod_definitions),
            "addedProvinceIds": sorted(tracked["customProvince"]),
            "changedPixels": pixel_delta["changedPixelCount"],
            "stateMembershipChanges": len(state_delta["provinceMembershipChanges"]),
            "addedStateIds": state_delta["addedIds"],
            "strategicRegionMembershipChanges": len(region_delta["provinceMembershipChanges"]),
            "addedStrategicRegionIds": region_delta["addedIds"],
            "referenceEvidenceLines": len(references),
        },
        "snapshots": {"base": base_snapshot, "mod": mod_snapshot},
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    print(f"Map delta snapshot: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
