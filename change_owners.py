#!/usr/bin/env python3
import os
import re
import glob

STATES_DIR = "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/history/states"

VALID_OWNERS = {
    "GER",
    "ENG",
    "SOV",
    "FRA",
    "LUX",
    "BEL",
    "HOL",
    "CZE",
    "POL",
    "AUS",
    "SPR",
    "ITA",
    "ROM",
    "YUG",
    "GRE",
    "ALB",
    "NOR",
    "DEN",
    "BUL",
    "POR",
    "HUN",
    "AST",
    "CAN",
    "CHI",
    "IRQ",
    "JAP",
    "MEX",
    "NZL",
    "PER",
    "SAF",
    "SIA",
    "USA",
    "MON",
    "RAJ",
    "MAN",
    "FIN",
    "BLT",
    "NPL",
}


def process_state_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    owner_match = re.search(r"^\s*owner\s*=\s*(\w+)", content, re.MULTILINE)
    if not owner_match:
        return False, None

    current_owner = owner_match.group(1)

    if current_owner not in VALID_OWNERS:
        new_content = re.sub(r"(\s*owner\s*=\s*)(\w+)", r"\1NPL", content, count=1)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)
        return True, current_owner

    return False, current_owner


def main():
    state_files = glob.glob(os.path.join(STATES_DIR, "*.txt"))

    changed = []
    kept = {}

    for filepath in sorted(state_files):
        was_changed, owner = process_state_file(filepath)
        filename = os.path.basename(filepath)

        if was_changed:
            changed.append((filename, owner))
        else:
            if owner:
                kept[owner] = kept.get(owner, 0) + 1

    print(f"Changed {len(changed)} states to NPL:")
    for fname, old_owner in changed:
        print(f"  {fname}: {old_owner} -> NPL")

    print(f"\nKept {sum(kept.values())} states with valid owners:")
    for owner, count in sorted(kept.items()):
        print(f"  {owner}: {count}")


if __name__ == "__main__":
    main()
