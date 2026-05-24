#!/usr/bin/env python3
"""Debug smoke test matching."""
import re

LOG_PATH = r"C:\Users\NickAdminRoot\Documents\Paradox Interactive\Hearts of Iron IV\logs\error.log"

def normalize_source_path(path):
    return path.strip().replace("\\", "/").lstrip("./")

HOI4_TEXT_EXTENSIONS = ('txt', 'gui', 'gfx', 'yml', 'csv', 'json', 'lua')
HOI4_SOURCE_ROOTS = ('common', 'events', 'history', 'localisation', 'interface', 'map', 'gfx', 'music', 'sound')

def find_entry_source(entry):
    ext_pat = "|".join(re.escape(ext) for ext in HOI4_TEXT_EXTENSIONS)
    root_pat = "|".join(re.escape(root) for root in HOI4_SOURCE_ROOTS)
    path_pat = rf"((?:{root_pat})/[A-Za-z0-9_./ -]+[.](?:{ext_pat}))"
    patterns = [
        rf'in file: "([^"]+)" near line: ([0-9]+)',
        rf'in file: "([^"]+)"',
        rf"\b{path_pat}\s+line\s*:\s*([0-9]+)",
        rf"\b{path_pat}:([0-9]+):",
        rf"\b{path_pat}:([0-9]+)\b",
        rf"\b{path_pat}\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, entry)
        if match:
            groups = [g for g in match.groups() if g is not None]
            path = normalize_source_path(groups[0])
            line = None
            for g in reversed(groups[1:]):
                if g.isdigit():
                    line = int(g)
                    break
            return (path, line)
    return (None, None)


log = open(LOG_PATH, encoding="utf-8").read()
start_re = re.compile(r"^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]\[")
entries = []
current = []
for line in log.splitlines():
    if start_re.match(line) and current:
        entries.append("\n".join(current))
        current = []
    current.append(line)
if current:
    entries.append("\n".join(current))

print(f"Total entries: {len(entries)}")

IGNORED = {"common/units/infantry.txt", "common/decisions/USA.txt"}
matching = []
ignored = 0
for entry in entries:
    source = find_entry_source(entry)
    if source[0] in IGNORED:
        ignored += 1
    else:
        matching.append(entry)

print(f"Matching: {len(matching)}, Ignored: {ignored}")

for i, entry in enumerate(matching[:20]):
    src = find_entry_source(entry)
    # Show first line only
    first_line = entry.splitlines()[0] if entry else ""
    print(f"  [{i+1}] {src} -> {first_line[:130]}")

print(f"\n... total matching: {len(matching)}")
