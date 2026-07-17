#!/usr/bin/env python3
"""
Auto-translate HOI4 mod localization by matching vanilla values.

Strategy:
  1. Parse ALL vanilla English → global dict: key → value
  2. Parse ALL vanilla Russian → global dict: key → translation
  3. Build reverse lookup: normalized_value → translation
  4. For each mod key: normalize value (strip £-codes + whitespace) → look up
  5. If match → use vanilla translation (prepend mod's £-codes)
  6. If no match → mark /* TODO */

Usage:
  python translate_vanilla.py --vanilla-dir "/path/to/Hearts of Iron IV/localisation" \
                              --mod-en-dir "/path/to/original_mod/localisation" \
                              --mod-ru-dir "/path/to/translation_mod/localisation"
"""

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

KEY_RE = re.compile(r'^([^:]+?):\d*\s+"(.*)"')
POUND_RE = re.compile(r'£\S+')


def normalize(value):
    """Strip ALL whitespace for comparison."""
    return re.sub(r'\s+', '', value)


def strip_pound(value):
    """Remove £-codes and normalize for comparison."""
    return normalize(POUND_RE.sub('', value))


def extract_pound(value):
    """Extract £-codes from value, preserving order."""
    return POUND_RE.findall(value)


def parse_keys(filepath):
    """Parse .yml file → dict: key → value. Handles key:0 and key: formats."""
    result = {}
    try:
        with open(filepath, 'r', encoding='utf-8-sig') as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    continue
                m = KEY_RE.match(stripped)
                if m:
                    result[m.group(1).strip()] = m.group(2)
    except Exception as e:
        print(f"  WARNING: Could not parse {filepath}: {e}", file=sys.stderr)
    return result


def build_dict(directory):
    """Build key→value dict from all .yml files in a directory."""
    d = {}
    for f in sorted(Path(directory).glob("*.yml")):
        d.update(parse_keys(f))
    return d


def build_reverse_lookup(vanilla_en, vanilla_ru):
    """Build normalized_value → (ru_translation, vanilla_en_value) lookup."""
    stripped_to_info = {}
    for key, value in vanilla_en.items():
        if key in vanilla_ru:
            sv = strip_pound(value)
            if sv not in stripped_to_info:
                stripped_to_info[sv] = []
            stripped_to_info[sv].append((vanilla_ru[key], value))

    # Deduplicate: pick most common translation
    result = {}
    for sv, items in stripped_to_info.items():
        counts = Counter(t for t, _ in items)
        best_ru = counts.most_common(1)[0][0]
        best_van_en = items[0][1]
        result[sv] = (best_ru, best_van_en)
    return result


def translate_file(en_filepath, stripped_lookup):
    """Translate one file using value-matching. Returns (content, stats)."""
    with open(en_filepath, 'r', encoding='utf-8-sig') as f:
        lines = f.readlines()

    stats = {"translated": 0, "needs_translation": 0}
    output = []

    for line in lines:
        stripped = line.strip()

        # Language header
        if stripped.startswith('l_english:'):
            output.append('l_russian:\n')
            continue

        # Key-value line
        m = KEY_RE.match(stripped)
        if not m:
            output.append(line)
            continue

        key = m.group(1).strip()
        value = m.group(2)
        sv = strip_pound(value)

        if sv in stripped_lookup:
            ru_translation, van_en = stripped_lookup[sv]

            # Extract £-codes from mod value and vanilla
            mod_pounds = extract_pound(value)
            van_pounds = extract_pound(van_en)

            # Strip £ from vanilla Russian (if any)
            ru_stripped = POUND_RE.sub('', ru_translation).strip()

            # Rebuild: mod's £-codes + Russian text
            if mod_pounds:
                final_value = ' '.join(mod_pounds) + '  ' + ru_stripped
            elif van_pounds:
                final_value = ' '.join(van_pounds) + '  ' + ru_stripped
            else:
                final_value = ru_stripped

            output.append(f' {key}: "{final_value}"\n')
            stats["translated"] += 1
        else:
            output.append(f' {key}: "/* TODO */ {value}"\n')
            stats["needs_translation"] += 1

    return ''.join(output), stats


def main():
    parser = argparse.ArgumentParser(description="Auto-translate HOI4 mod from vanilla")
    parser.add_argument("--vanilla-dir", required=True, help="HOI4 localisation/ dir")
    parser.add_argument("--mod-en-dir", required=True, help="Original mod's localisation/ dir")
    parser.add_argument("--mod-ru-dir", required=True, help="Output Russian localisation/ dir")
    args = parser.parse_args()

    vanilla_en_dir = Path(args.vanilla_dir) / "english"
    vanilla_ru_dir = Path(args.vanilla_dir) / "russian"
    mod_en_dir = Path(args.mod_en_dir)
    mod_ru_dir = Path(args.mod_ru_dir)

    print("Building vanilla dictionaries...")
    vanilla_en = build_dict(vanilla_en_dir)
    vanilla_ru = build_dict(vanilla_ru_dir)
    print(f"  Vanilla EN keys: {len(vanilla_en)}")
    print(f"  Vanilla RU keys: {len(vanilla_ru)}")

    stripped_lookup = build_reverse_lookup(vanilla_en, vanilla_ru)
    print(f"  Stripped-value matches: {len(stripped_lookup)}")

    total = {"translated": 0, "needs_translation": 0}

    # Process root files
    for en_file in sorted(mod_en_dir.glob("*_l_english.yml")):
        ru_file = mod_ru_dir / en_file.name.replace('_l_english.yml', '_l_russian.yml')
        ru_file.parent.mkdir(parents=True, exist_ok=True)
        content, stats = translate_file(en_file, stripped_lookup)
        with open(ru_file, 'w', encoding='utf-8-sig') as f:
            f.write(content)
        n = stats["translated"] + stats["needs_translation"]
        pct = stats["translated"] / n * 100 if n else 100
        print(f"  {en_file.name}: {stats['translated']}/{n} ({pct:.0f}%)")
        total["translated"] += stats["translated"]
        total["needs_translation"] += stats["needs_translation"]

    # Process replace/ files
    mod_en_replace = mod_en_dir / "replace"
    if mod_en_replace.is_dir():
        for en_file in sorted(mod_en_replace.glob("*_l_english.yml")):
            ru_file = mod_ru_dir / "replace" / en_file.name.replace('_l_english.yml', '_l_russian.yml')
            ru_file.parent.mkdir(parents=True, exist_ok=True)
            content, stats = translate_file(en_file, stripped_lookup)
            with open(ru_file, 'w', encoding='utf-8-sig') as f:
                f.write(content)
            n = stats["translated"] + stats["needs_translation"]
            pct = stats["translated"] / n * 100 if n else 100
            print(f"  replace/{en_file.name}: {stats['translated']}/{n} ({pct:.0f}%)")
            total["translated"] += stats["translated"]
            total["needs_translation"] += stats["needs_translation"]

    all_keys = total["translated"] + total["needs_translation"]
    pct = total["translated"] / all_keys * 100 if all_keys else 100
    print(f"\nTotal: {total['translated']}/{all_keys} ({pct:.0f}%) auto-translated")
    print(f"Needs manual (TODO): {total['needs_translation']}/{all_keys}")


if __name__ == "__main__":
    main()
