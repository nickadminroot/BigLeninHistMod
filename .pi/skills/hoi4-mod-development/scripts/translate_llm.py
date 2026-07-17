#!/usr/bin/env python3
"""Batch translate HOI4 mod localization via OpenAI-compatible API.

Uses the openai library (pip install openai) for reliable API calls.
Reads TODO-marked keys, sends batches to LLM, writes translations back.

Usage:
  python translate_llm.py                         # translate all TODOs
  python translate_llm.py --batch-size 500        # custom batch size
  python translate_llm.py --model deepseek-chat   # custom model
  python translate_llm.py --dry-run               # preview without API calls

Environment:
  LLM_API_KEY     - API key (required)
  LLM_API_BASE    - API base URL (default: https://opencode.ai/zen/go/v1)
  LLM_MODEL       - Model name (default: deepseek-v4-flash)

Or create .env file next to the script with these values.
"""

from openai import OpenAI
from pathlib import Path
import re, json, sys, argparse, time

# --- Config ---
def load_env():
    env = {}
    for p in [Path(__file__).parent / ".env", Path.cwd() / ".env"]:
        if p.exists():
            for line in p.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env

env = load_env()

# --- Paths ---
TODO_RE = re.compile(r'^ (\S+): "(/\* TODO \*/ )(.*)"$')

def find_todos(fp):
    """Find all TODO keys in a file."""
    return [(i, m.group(1), m.group(3))
            for i, line in enumerate(open(fp, encoding='utf-8-sig'))
            if (m := TODO_RE.match(line.rstrip('\r\n')))]

def translate_batch(client, model, items):
    """Translate a batch of key:value pairs via LLM."""
    text = "\n".join(f'{k}: "{v[:500]}"' for k, v in items)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content":
            f"Translate HOI4 localization English→Russian. "
            f"Keep §-codes, £-icons, $VARS$, \\n, %N, [GetName] as-is. "
            f"Use game terminology (stability=стабильность, war support=поддержка войны). "
            f"Return ONLY key: \"translation\" lines.\n\n{text}"}]
    )
    return {m.group(1): m.group(2)
            for line in resp.choices[0].message.content.strip().split('\n')
            if (m := re.match(r'^(\S+):\s*"(.*)"$', line.strip()))}

def apply_translations(fp, trans):
    """Apply translations to file, return count applied."""
    lines = open(fp, encoding='utf-8-sig').readlines()
    n = 0
    for i, line in enumerate(lines):
        m = TODO_RE.match(line.rstrip('\r\n'))
        if m and m.group(1) in trans:
            lines[i] = f' {m.group(1)}: "{trans[m.group(1)]}"\n'
            n += 1
    open(fp, 'w', encoding='utf-8-sig').writelines(lines)
    return n

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mod-dir", type=str)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--model", type=str, default=env.get("LLM_MODEL", "deepseek-v4-flash"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    api_key = env.get("LLM_API_KEY", "")
    if not api_key:
        print("ERROR: Set LLM_API_KEY in .env or environment")
        sys.exit(1)

    client = OpenAI(api_key=api_key, base_url=env.get("LLM_API_BASE", "https://opencode.ai/zen/go/v1"))

    # Find mod directory
    if args.mod_dir:
        mod_dir = Path(args.mod_dir)
    else:
        for c in [Path.cwd(), Path.cwd().parent]:
            if (c / "localisation").is_dir():
                mod_dir = c / "localisation"
                break
        else:
            print("ERROR: Cannot find localisation/ directory")
            sys.exit(1)

    progress_file = mod_dir.parent / ".translate_progress.json"
    progress = json.loads(progress_file.read_text()) if progress_file.exists() else {}

    # Find all TODOs
    all_todos = {}
    for yml in sorted(mod_dir.rglob("*_l_russian.yml")):
        todos = find_todos(yml)
        if todos:
            all_todos[yml] = todos

    total = sum(len(t) for t in all_todos.values())
    print(f"Model: {args.model}, Batch: {args.batch_size}, TODOs: {total}")

    done = 0
    for fp, todos in all_todos.items():
        rel = str(fp.relative_to(mod_dir))
        skip = set(progress.get(rel, []))
        remaining = [(i, k, v) for i, k, v in todos if k not in skip]
        if not remaining:
            continue

        print(f"\n{rel}: {len(remaining)} keys")

        for start in range(0, len(remaining), args.batch_size):
            batch = remaining[start:start + args.batch_size]
            kv = [(k, v) for _, k, v in batch]

            if args.dry_run:
                print(f"  #{start//args.batch_size+1}: [DRY] {len(batch)} keys")
                continue

            try:
                trans = translate_batch(client, args.model, kv)
                n = apply_translations(fp, trans)
                done += n
                progress.setdefault(rel, []).extend(trans.keys())
                progress_file.write_text(json.dumps(progress, indent=2))
                print(f"  #{start//args.batch_size+1}: {n}/{len(batch)}")
                time.sleep(0.5)
            except Exception as e:
                print(f"  ERROR: {e}")

    print(f"\nDone: {done} translated")
