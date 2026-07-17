#!/usr/bin/env python3
"""
Universal HOI4 installation path detection.
Works on Windows, Linux, and macOS.

Usage:
    from hoi4_detect import find_hoi4_dir, find_pdx_user_dir
    hoi4_dir = find_hoi4_dir()
    pdx_user_dir = find_pdx_user_dir()
"""
from __future__ import annotations

import os
import re
import sys
import json
from pathlib import Path
from typing import Optional

# Common HOI4 executable names
HOI4_EXE_NAMES = ["hoi4.exe", "hoi4"]

# Common Steam library paths per platform
STEAM_PATHS = {
    "win32": [
        r"C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV",
        r"C:\Program Files\Steam\steamapps\common\Hearts of Iron IV",
        r"D:\SteamLibrary\steamapps\common\Hearts of Iron IV",
        r"E:\SteamLibrary\steamapps\common\Hearts of Iron IV",
        r"F:\SteamLibrary\steamapps\common\Hearts of Iron IV",
        r"G:\SteamLibrary\steamapps\common\Hearts of Iron IV",
    ],
    "linux": [
        "~/.steam/steam/steamapps/common/Hearts of Iron IV",
        "~/.local/share/Steam/steamapps/common/Hearts of Iron IV",
        "~/.steam/steam/steamapps/common/Hearts of Iron IV/",
    ],
    "darwin": [
        "~/Library/Application Support/Steam/steamapps/common/Hearts of Iron IV",
    ],
}

# Paradox user data paths
PDX_USER_PATHS = {
    "win32": [
        os.path.expanduser("~/Documents/Paradox Interactive/Hearts of Iron IV"),
        os.path.expanduser("~/OneDrive/Documents/Paradox Interactive/Hearts of Iron IV"),
    ],
    "linux": [
        "~/.paradoxplaza/Hearts of Iron IV",
        "~/.local/share/Paradox Interactive/Hearts of Iron IV",
    ],
    "darwin": [
        "~/Documents/Paradox Interactive/Hearts of Iron IV",
        "~/Library/Application Support/Paradox Interactive/Hearts of Iron IV",
    ],
}


def _expand(path: str) -> Path:
    """Expand ~ and environment variables in path."""
    return Path(os.path.expandvars(os.path.expanduser(path)))


def _find_steam_libraries_from_vdf() -> list[Path]:
    """Parse Steam libraryfolders.vdf to find custom Steam libraries."""
    libraries = []
    platform = sys.platform

    if platform == "win32":
        vdf_paths = [
            Path(r"C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf"),
            Path(r"C:\Program Files\Steam\steamapps\libraryfolders.vdf"),
        ]
    elif platform == "linux":
        vdf_paths = [
            Path("~/.steam/steam/steamapps/libraryfolders.vdf"),
            Path("~/.local/share/Steam/steamapps/libraryfolders.vdf"),
        ]
    else:
        vdf_paths = [
            Path("~/Library/Application Support/Steam/steamapps/libraryfolders.vdf"),
        ]

    for vdf_path in vdf_paths:
        vdf_file = vdf_path.expanduser()
        if not vdf_file.is_file():
            continue

        try:
            content = vdf_file.read_text(errors="replace")
            # Parse "path" entries from VDF format
            for match in re.finditer(r'"path"\s+"([^"]+)"', content):
                lib_path = Path(match.group(1))
                if lib_path.is_dir():
                    libraries.append(lib_path)
        except Exception:
            continue

    return libraries


def find_hoi4_dir(env_var: str = "HOI4_DIR") -> Optional[Path]:
    """
    Find HOI4 installation directory.
    
    Search order:
    1. HOI4_DIR environment variable
    2. Steam libraryfolders.vdf custom paths
    3. Common platform-specific paths
    
    Returns None if not found.
    """
    # 1. Check environment variable
    env_path = os.environ.get(env_var)
    if env_path:
        p = Path(env_path)
        if p.is_dir():
            # Verify it looks like HOI4 dir
            for exe_name in HOI4_EXE_NAMES:
                if (p / exe_name).exists():
                    return p
            # Even without exe, return if it has expected subdirs
            if (p / "common").is_dir() or (p / "bin").is_dir():
                return p

    # 2. Search Steam libraries from VDF
    for lib_path in _find_steam_libraries_from_vdf():
        candidate = lib_path / "steamapps" / "common" / "Hearts of Iron IV"
        if candidate.is_dir():
            return candidate

    # 3. Search common paths
    platform = sys.platform
    for path_str in STEAM_PATHS.get(platform, STEAM_PATHS.get("win32", [])):
        candidate = _expand(path_str)
        if candidate.is_dir():
            return candidate

    return None


def find_pdx_user_dir(env_var: str = "PDX_USER_DIR") -> Optional[Path]:
    """
    Find Paradox user data directory (where logs/, mod/, save games live).
    
    Search order:
    1. PDX_USER_DIR environment variable
    2. Common platform-specific paths
    
    Returns None if not found.
    """
    # 1. Check environment variable
    env_path = os.environ.get(env_var)
    if env_path:
        p = Path(env_path)
        if p.is_dir():
            return p

    # 2. Search common paths
    platform = sys.platform
    for path_str in PDX_USER_PATHS.get(platform, PDX_USER_PATHS.get("win32", [])):
        candidate = _expand(path_str)
        if candidate.is_dir():
            return candidate

    return None


def find_mod_dir(mod_name: str, pdx_user_dir: Optional[Path] = None) -> Optional[Path]:
    """
    Find mod directory inside Paradox user data.
    
    Checks:
    1. ./mod/<mod_name> relative to pdx_user_dir
    2. ./mod/<mod_name>.mod descriptor
    """
    if pdx_user_dir is None:
        pdx_user_dir = find_pdx_user_dir()
    if pdx_user_dir is None:
        return None

    mod_dir = pdx_user_dir / "mod" / mod_name
    if mod_dir.is_dir():
        return mod_dir

    return None


def find_repo_mod_dir(repo_root: Path, mod_name: str) -> Optional[Path]:
    """
    Find mod directory within a repository structure.
    Looks for <repo_root>/<mod_name>/ as a subdirectory.
    """
    candidate = repo_root / mod_name
    if candidate.is_dir():
        # Verify it has a descriptor.mod
        if (candidate / "descriptor.mod").is_file():
            return candidate
    return None


def require_hoi4_dir(env_var: str = "HOI4_DIR") -> Path:
    """Find HOI4 dir or raise SystemExit with helpful message."""
    hoi4_dir = find_hoi4_dir(env_var)
    if hoi4_dir is None:
        print(
            "Error: Could not find Hearts of Iron IV installation.\n"
            f"Set the {env_var} environment variable to your HOI4 install path.\n"
            "Example: export HOI4_DIR=\"/path/to/Hearts of Iron IV\"\n"
            "Windows: set HOI4_DIR=G:\\SteamLibrary\\steamapps\\common\\Hearts of Iron IV",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return hoi4_dir


def require_pdx_user_dir(env_var: str = "PDX_USER_DIR") -> Path:
    """Find Paradox user dir or raise SystemExit with helpful message."""
    pdx_dir = find_pdx_user_dir(env_var)
    if pdx_dir is None:
        print(
            "Error: Could not find Paradox user data directory.\n"
            f"Set the {env_var} environment variable.\n"
            "Example: export PDX_USER_DIR=\"~/Documents/Paradox Interactive/Hearts of Iron IV\"",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return pdx_dir


if __name__ == "__main__":
    # Diagnostic output
    print("HOI4 Path Detection Diagnostic")
    print("=" * 40)

    hoi4 = find_hoi4_dir()
    print(f"HOI4 dir:   {hoi4 or 'NOT FOUND'}")

    pdx = find_pdx_user_dir()
    print(f"PDX user:   {pdx or 'NOT FOUND'}")

    if hoi4:
        exe = hoi4 / "hoi4.exe"
        if exe.exists():
            print(f"HOI4 exe:   {exe} (found)")
        else:
            print(f"HOI4 exe:   {exe} (NOT FOUND)")

        steam_libs = _find_steam_libraries_from_vdf()
        print(f"Steam libs: {len(steam_libs)} found from VDF")
        for lib in steam_libs:
            print(f"  - {lib}")

    print(f"Platform:   {sys.platform}")
    print(f"HOI4_DIR:   {os.environ.get('HOI4_DIR', '(not set)')}")
    print(f"PDX_USER_DIR: {os.environ.get('PDX_USER_DIR', '(not set)')}")
