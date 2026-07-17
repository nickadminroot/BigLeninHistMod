#!/usr/bin/env python3
"""
Upload HOI4 mod to Steam Workshop via SteamCMD.

Usage:
    python hoi4_workshop_upload.py                              # Session-based (manual login required first time)
    python hoi4_workshop_upload.py --login USER --password PASS  # With credentials
    python hoi4_workshop_upload.py --dry-run                    # Preview VDF only

Environment variables (or .env file):
    STEAM_USER    - Steam username
    STEAM_PASS    - Steam password (optional if session exists)
    STEAMCMD_PATH - Path to steamcmd.exe (auto-detected)

First-time setup:
    1. Run manually: python scripts/hoi4_workshop_upload.py --login YOUR_USER --password YOUR_PASS
    2. Enter Steam Guard code when prompted
    3. After that, subsequent runs can use session: python scripts/hoi4_workshop_upload.py

Session files are stored in STEAMCMD_DIR/config/ and preserved between runs.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
MOD_NAME = "BigLeninHistMod"
APP_ID = "394360"

DEFAULT_STEAMCMD_PATHS = [
    Path("D:/SteamCMD/steamcmd.exe"),
    Path("C:/Program Files (x86)/Steam/steamapps/common/SteamCMD/steamcmd.exe"),
    Path.home() / "steamcmd" / "steamcmd.exe",
]

# .env file location (in repo root)
ENV_FILE = REPO_ROOT / ".env"
# Also check script directory
ENV_FILE_ALT = SCRIPT_DIR / ".env"


def load_dotenv(path: Path) -> None:
    """Load .env file into os.environ (simple parser, no external deps)."""
    if not path.is_file():
        return
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:  # Don't override existing env vars
                os.environ[key] = value


def find_steamcmd() -> Path | None:
    """Find steamcmd.exe."""
    env_path = os.environ.get("STEAMCMD_PATH")
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return p
    for candidate in DEFAULT_STEAMCMD_PATHS:
        if candidate.is_file():
            return candidate
    return None


def find_mod_folder() -> Path | None:
    """Find the mod content folder (contains descriptor.mod)."""
    for candidate in REPO_ROOT.glob("*/descriptor.mod"):
        return candidate.parent
    for candidate in Path(".").glob("*/descriptor.mod"):
        return candidate.parent
    return None


def parse_descriptor(descriptor: Path) -> dict[str, str]:
    """Parse descriptor.mod into a dict."""
    content = descriptor.read_text(errors="replace")
    result = {}
    for match in re.finditer(r'^(\w+)\s*=\s*"([^"]*)"', content, re.MULTILINE):
        result[match.group(1)] = match.group(2)
    tags_match = re.search(r'tags\s*=\s*\{([^}]+)\}', content, re.DOTALL)
    if tags_match:
        result["tags"] = re.findall(r'"([^"]+)"', tags_match.group(1))
    return result


def generate_vdf(
    mod_folder: Path,
    preview_path: Path | None = None,
    title: str | None = None,
    description: str | None = None,
    changenote: str = "Updated via SteamCMD",
    visibility: str = "0",
) -> str:
    """Generate VDF content for Steam Workshop upload."""
    descriptor = mod_folder / "descriptor.mod"
    desc_data = parse_descriptor(descriptor) if descriptor.exists() else {}
    publishedfileid = desc_data.get("remote_file_id", "0")

    if preview_path is None:
        for candidate in ["thumbnail.png", "preview.png", "preview.jpg"]:
            p = mod_folder / candidate
            if p.exists():
                preview_path = p
                break

    title = title or desc_data.get("name", MOD_NAME)
    description = description or f"A HOI4 mod: {title}"
    content_path = str(mod_folder.resolve()).replace("/", "\\")
    preview_str = str(preview_path.resolve()).replace("/", "\\") if preview_path else ""

    vdf = '"workshopitem"\n'
    vdf += '{\n'
    vdf += f'    "appid"             "{APP_ID}"\n'
    vdf += f'    "publishedfileid"   "{publishedfileid}"\n'
    vdf += f'    "contentfolder"     "{content_path}"\n'
    if preview_str:
        vdf += f'    "previewfile"       "{preview_str}"\n'
    vdf += f'    "visibility"        "{visibility}"\n'
    vdf += f'    "title"             "{title}"\n'
    vdf += f'    "description"       "{description}"\n'
    vdf += f'    "changenote"        "{changenote}"\n'
    vdf += '}\n'
    return vdf


def run_steamcmd(
    steamcmd: Path,
    username: str | None,
    password: str | None,
    vdf_path: Path,
) -> int:
    """Run SteamCMD to upload the mod.

    Three modes:
    1. username + password: full login (first time or session expired)
    2. username only: session-based (Steam Guard already passed)
    3. no username: interactive prompt
    """
    commands = []

    if username and password:
        # Full login with credentials — password in args
        commands.append(f"+login {username} {password}")
        print(f"Login: {username} (with password)")
    elif username:
        # Session-based login — try without password first
        commands.append(f"+login {username}")
        print(f"Login: {username} (session-based)")
    else:
        # Interactive login — SteamCMD will prompt
        commands.append("+login")
        print("Login: interactive (you will be prompted)")

    commands.append("+workshop_build_item")
    commands.append(str(vdf_path))
    commands.append("+quit")

    # Build command list — pass args directly to avoid quoting issues
    cmd = [str(steamcmd)] + commands
    print(f"Running: {steamcmd} +login ... +workshop_build_item ... +quit")
    print()

    # Use subprocess.run with stdin=sys.stdin for interactive prompts
    # This allows SteamCMD to read password/Steam Guard from terminal
    result = subprocess.run(
        cmd,
        stdin=sys.stdin if not password else None,
        text=True,
    )

    return result.returncode


def update_descriptor_published_id(descriptor: Path, published_id: str) -> None:
    """Update descriptor.mod with the publishedfileid."""
    content = descriptor.read_text(errors="replace")
    if "remote_file_id" in content:
        content = re.sub(
            r'remote_file_id\s*=\s*"[^"]*"',
            f'remote_file_id="{published_id}"',
            content,
        )
    else:
        content = content.rstrip() + f'\nremote_file_id="{published_id}"\n'
    descriptor.write_text(content)
    print(f"Updated {descriptor} with remote_file_id={published_id}")


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Upload HOI4 mod to Steam Workshop")
    parser.add_argument("--login", "-l", help="Steam username")
    parser.add_argument("--password", "-p", help="Steam password (use .env or env var instead)")
    parser.add_argument("--preview", help="Preview image path")
    parser.add_argument("--title", "-t", help="Workshop title")
    parser.add_argument("--description", "-d", help="Workshop description")
    parser.add_argument("--changenote", "-c", default="Updated via SteamCMD", help="Change note")
    parser.add_argument("--visibility", "-v", default="0", choices=["0", "1", "2"],
                        help="0=Public, 1=Friends, 2=Private")
    parser.add_argument("--dry-run", action="store_true", help="Generate VDF without uploading")
    parser.add_argument("--vdf-only", action="store_true", help="Only generate VDF file")
    args = parser.parse_args()

    # Load .env file — check multiple locations
    load_dotenv(ENV_FILE)           # In skill directory
    load_dotenv(ENV_FILE_ALT)       # Alt location
    load_dotenv(Path(".env"))       # In current working directory
    load_dotenv(REPO_ROOT / ".env") # In repo root (if different from CWD)

    # Resolve credentials: CLI args > env vars
    username = args.login or os.environ.get("STEAM_USER")
    password = args.password or os.environ.get("STEAM_PASS")

    # Find SteamCMD
    steamcmd = find_steamcmd()
    if steamcmd is None:
        print("Error: steamcmd.exe not found.", file=sys.stderr)
        print("Install SteamCMD:", file=sys.stderr)
        print("  1. Download from https://developer.valvesoftware.com/wiki/SteamCMD", file=sys.stderr)
        print("  2. Extract to D:/SteamCMD/ or set STEAMCMD_PATH", file=sys.stderr)
        return 1
    print(f"SteamCMD: {steamcmd}")

    # Find mod folder
    mod_folder = find_mod_folder()
    if mod_folder is None:
        print("Error: Could not find mod folder (no descriptor.mod found)", file=sys.stderr)
        return 1
    print(f"Mod folder: {mod_folder}")

    # Generate VDF
    preview_path = Path(args.preview) if args.preview else None
    vdf_content = generate_vdf(
        mod_folder=mod_folder,
        preview_path=preview_path,
        title=args.title,
        description=args.description,
        changenote=args.changenote,
        visibility=args.visibility,
    )

    # Save VDF
    vdf_path = SCRIPT_DIR / "hoi4_upload.vdf"
    vdf_path.write_text(vdf_content)
    print(f"Generated VDF: {vdf_path}")
    print()
    print("VDF content:")
    print(vdf_content)

    if args.vdf_only:
        return 0

    if args.dry_run:
        print("Dry run — not uploading")
        return 0

    # Determine login mode
    if username and password:
        print(f"Mode: password login ({username})")
    elif username:
        print(f"Mode: session login ({username}) — requires prior manual login")
    else:
        print("Mode: interactive — you will be prompted for credentials")

    print()
    print("=" * 50)
    print("Uploading to Steam Workshop...")
    print("=" * 50)
    print()

    result = run_steamcmd(steamcmd, username, password, vdf_path)

    if result == 0:
        print()
        print("Upload completed successfully!")
        print("Check your Steam Workshop page to verify.")
    else:
        print()
        print(f"Upload failed with exit code {result}")
        print("Common issues:")
        print("  - Steam Guard code required (run manually first time)")
        print("  - Invalid credentials")
        print("  - Network error")
        print("  - Check output above for details")

    return result


if __name__ == "__main__":
    raise SystemExit(main())
