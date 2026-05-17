#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator
from pathlib import Path


MOD_NAME = "BigLeninHistMod"
DEFAULT_HOI4_DIR = r"G:\SteamLibrary\steamapps\common\Hearts of Iron IV"
IGNORED_ERROR_FILES = frozenset(
    {
        "common/units/infantry.txt",
        "common/decisions/USA.txt",
    }
)
HOI4_TEXT_EXTENSIONS = (
    "txt",
    "gui",
    "gfx",
    "yml",
    "csv",
    "json",
    "lua",
)
HOI4_SOURCE_ROOTS = (
    "common",
    "events",
    "history",
    "localisation",
    "interface",
    "map",
    "gfx",
    "music",
    "sound",
)


@dataclass(frozen=True)
class Source:
    path: str | None
    line: int | None

    @property
    def label(self) -> str:
        if self.path and self.line is not None:
            return f"{self.path}:{self.line}"
        if self.path:
            return self.path
        return "source unknown"


def env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def die(message: str) -> None:
    print(f"hoi4-smoke-windows: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_duration(value: str) -> float:
    match = re.fullmatch(r"\s*([0-9]+(?:[.][0-9]+)?)([smhd]?)\s*", value)
    if not match:
        die(f"invalid SMOKE_TIMEOUT: {value!r}")
    amount = float(match.group(1))
    suffix = match.group(2) or "s"
    factors = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    return amount * factors[suffix]


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        die(f"missing {label}: {path}")


def windows_mod_path(path: Path) -> str:
    return path.resolve().as_posix()


def write_mod_metadata(descriptor: Path, mod_dir: Path, output: Path) -> None:
    lines = descriptor.read_text(errors="replace").splitlines()
    without_path = [line for line in lines if not re.match(r"\s*path\s*=", line)]
    output.write_text("\n".join(without_path) + f'\npath="{windows_mod_path(mod_dir)}"\n')


def seed_dlc_state(normal_data: Path, game_data: Path, dlc_load_file: Path) -> None:
    for filename in ("dlc_signature", "game_data.json"):
        source = normal_data / filename
        target = game_data / filename
        if source.is_file() and source.resolve() != target.resolve():
            shutil.copy2(source, game_data / filename)

    normal_dlc_load = normal_data / "dlc_load.json"
    data: dict[str, object] = {"enabled_mods": [], "disabled_dlcs": []}
    if normal_dlc_load.is_file():
        try:
            data = json.loads(normal_dlc_load.read_text())
        except json.JSONDecodeError as exc:
            die(f"could not parse normal dlc_load.json: {exc}")

    disabled_dlcs = data.get("disabled_dlcs", [])
    if not isinstance(disabled_dlcs, list):
        disabled_dlcs = []

    dlc_load_file.write_text(
        json.dumps(
            {"enabled_mods": [f"mod/{MOD_NAME}.mod"], "disabled_dlcs": disabled_dlcs},
            indent=2,
        )
        + "\n"
    )


@contextmanager
def backed_up_file(path: Path) -> Iterator[None]:
    backup = path.with_name(f"{path.name}.hoi4-smoke-backup")
    existed = path.exists()
    if existed:
        shutil.copy2(path, backup)
    elif backup.exists():
        backup.unlink()
    try:
        yield
    finally:
        if existed:
            backup.replace(path)
        else:
            path.unlink(missing_ok=True)
            backup.unlink(missing_ok=True)


def set_cream_unlockall(cream_api_ini: Path, enabled: bool) -> None:
    if not cream_api_ini.is_file():
        return

    desired = "true" if enabled else "false"
    lines = cream_api_ini.read_text(errors="replace").splitlines()
    output: list[str] = []
    in_steam_section = False
    changed = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_steam_section = stripped.lower() == "[steam]"
        if in_steam_section and re.match(r"\s*unlockall\s*=", line, re.IGNORECASE):
            prefix = line[: len(line) - len(line.lstrip())]
            output.append(f"{prefix}unlockall = {desired}")
            changed = True
        else:
            output.append(line)

    if not changed:
        for index, line in enumerate(output):
            if line.strip().lower() == "[steam]":
                output.insert(index + 1, f"unlockall = {desired}")
                changed = True
                break

    if changed:
        cream_api_ini.write_text("\n".join(output) + "\n")


def terminate_process_tree(proc: subprocess.Popen[str]) -> int:
    subprocess.run(
        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    return 124


def run_hoi4(
    hoi4_exe: Path,
    hoi4_dir: Path,
    crash_dir: Path,
    smoke_tag: str,
    timeout_seconds: float,
    launch_log: Path,
) -> int:
    command = [
        str(hoi4_exe),
        "-gdpr-compliant",
        "-debug_mode",
        "-debug",
        f"-start_tag={smoke_tag}",
        f"--crashdir={crash_dir}",
    ]
    child_env = os.environ.copy()

    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    with launch_log.open("w", errors="replace") as log:
        proc = subprocess.Popen(
            command,
            cwd=hoi4_dir,
            env=child_env,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
            text=True,
        )
        try:
            return proc.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            return terminate_process_tree(proc)


def iter_log_entries(error_log: Path) -> list[str]:
    entries: list[str] = []
    current: list[str] = []
    start_re = re.compile(r"^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]\[")
    for raw_line in error_log.read_text(errors="replace").splitlines():
        if start_re.match(raw_line) and current:
            entries.append("\n".join(current))
            current = []
        current.append(raw_line)
    if current:
        entries.append("\n".join(current))
    return entries


def normalize_source_path(path: str) -> str:
    return path.strip().replace("\\", "/").lstrip("./")


def find_entry_source(entry: str) -> Source:
    extension_pattern = "|".join(re.escape(ext) for ext in HOI4_TEXT_EXTENSIONS)
    root_pattern = "|".join(re.escape(root) for root in HOI4_SOURCE_ROOTS)
    path_pattern = rf"((?:{root_pattern})/[A-Za-z0-9_./ -]+[.](?:{extension_pattern}))"
    patterns = [
        rf'in file: "([^"]+)" near line: ([0-9]+)',
        rf'in file: "([^"]+)"',
        rf"\b{path_pattern}\s+line\s*:\s*([0-9]+)",
        rf"\b{path_pattern}:([0-9]+):",
        rf"\b{path_pattern}:([0-9]+)\b",
        rf"\b{path_pattern}\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, entry)
        if match:
            groups = [group for group in match.groups() if group is not None]
            path = normalize_source_path(groups[0])
            line = None
            for group in reversed(groups[1:]):
                if group.isdigit():
                    line = int(group)
                    break
            return Source(path=path, line=line)
    return Source(path=None, line=None)


def entry_channel(entry: str) -> str:
    match = re.match(r"^\[[^\]]+\]\[[^\]]+\]\[([^\]]+)\]:", entry)
    return match.group(1) if match else "unknown"


def strip_log_prefix(line: str) -> str:
    return re.sub(r"^\[[^\]]+\]\[[^\]]+\]\[[^\]]+\]:\s*", "", line)


def format_entry(index: int, entry: str, max_lines: int) -> list[str]:
    lines = entry.splitlines()
    source = find_entry_source(entry)
    channel = entry_channel(entry)
    if source.path:
        rendered = [f"[{index}] {source.label} ({channel})"]
    else:
        rendered = [f"[{index}] {channel} (no file source)"]
    visible = [strip_log_prefix(lines[0]), *lines[1:]]
    for line in visible[:max_lines]:
        rendered.append(f"    {line}")
    if len(visible) > max_lines:
        rendered.append(f"    ... {len(visible) - max_lines} more line(s) in this entry")
    return rendered


def classify_errors(
    error_log: Path,
    include_pattern: str | None,
) -> tuple[list[str], list[str]]:
    matcher = re.compile(include_pattern) if include_pattern else None
    matching: list[str] = []
    ignored_entries: list[str] = []
    for entry in iter_log_entries(error_log):
        if matcher and not matcher.search(entry):
            continue
        source = find_entry_source(entry)
        if source.path in IGNORED_ERROR_FILES:
            ignored_entries.append(entry)
        else:
            matching.append(entry)
    return matching, ignored_entries


def print_failure_summary(
    entries: list[str],
    ignored_entries: list[str],
    error_log: Path,
    smoke_root: Path,
    max_entries: int,
    max_entry_lines: int,
) -> None:
    print("hoi4-smoke-windows: FAIL serious startup/load errors", file=sys.stderr)
    print(f"  error log: {error_log}", file=sys.stderr)
    print(f"  retained data: {smoke_root}", file=sys.stderr)
    print(f"  matching entries: {len(entries)}", file=sys.stderr)
    print(f"  ignored entries: {len(ignored_entries)}", file=sys.stderr)

    sources = [find_entry_source(entry).path for entry in entries]
    unknown_source_count = sum(1 for source in sources if source is None)
    by_source = Counter(source for source in sources if source is not None)
    print(f"  entries without file source: {unknown_source_count}", file=sys.stderr)
    print("  top file sources:", file=sys.stderr)
    for source, count in by_source.most_common(8):
        print(f"    {count:4d}  {source}", file=sys.stderr)

    shown = entries[:max_entries]
    print(f"  first {len(shown)} error entries:", file=sys.stderr)
    for index, entry in enumerate(shown, start=1):
        for line in format_entry(index, entry, max_entry_lines):
            print(f"    {line}", file=sys.stderr)
    if len(entries) > max_entries:
        print(
            f"    ... {len(entries) - max_entries} more entries; inspect error.log for full details",
            file=sys.stderr,
        )


def default_normal_game_data(repo_root: Path) -> Path:
    if repo_root.parent.name.lower() == "mod":
        return repo_root.parent.parent
    return Path.home() / "Documents/Paradox Interactive/Hearts of Iron IV"


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    mod_dir = repo_root / MOD_NAME

    hoi4_dir = Path(env("HOI4_DIR", DEFAULT_HOI4_DIR))
    normal_game_data = Path(env("PDX_USER_DIR", str(default_normal_game_data(repo_root))))
    smoke_timeout = env("SMOKE_TIMEOUT", "120s")
    smoke_tag = env("SMOKE_TAG", "GER")
    keep_data_requested = env("HOI4_SMOKE_KEEP_DATA", "0") == "1"
    max_error_entries = int(env("SMOKE_MAX_ERROR_ENTRIES", "40"))
    max_entry_lines = int(env("SMOKE_MAX_ENTRY_LINES", "8"))
    include_pattern = os.environ.get("SMOKE_INCLUDE_PATTERN")

    hoi4_exe = hoi4_dir / "hoi4.exe"
    cream_api_ini = hoi4_dir / "cream_api.ini"
    descriptor = mod_dir / "descriptor.mod"

    require_file(hoi4_exe, "hoi4.exe")
    require_file(descriptor, "mod descriptor")
    if not normal_game_data.is_dir():
        die(f"missing normal Paradox user-data dir: {normal_game_data}")

    fixed_smoke_home = os.environ.get("PDX_SMOKE_HOME")
    if fixed_smoke_home:
        smoke_root = Path(fixed_smoke_home)
        keep_data = True
        smoke_root.mkdir(parents=True, exist_ok=True)
    else:
        smoke_root = Path(tempfile.mkdtemp(prefix="hoi4-smoke-win."))
        keep_data = keep_data_requested

    try:
        game_data_dir = normal_game_data
        mod_metadata_dir = game_data_dir / "mod"
        log_dir = game_data_dir / "logs"
        mod_metadata_file = mod_metadata_dir / f"{MOD_NAME}.mod"
        dlc_load_file = game_data_dir / "dlc_load.json"
        error_log = log_dir / "error.log"
        launch_log = smoke_root / "hoi4-launch.log"
        matches_file = smoke_root / "matching-errors.txt"
        crash_dir = smoke_root / "crashes"
        previous_error_log_mtime = error_log.stat().st_mtime if error_log.exists() else None
        cream_unlockall = env("HOI4_SMOKE_CREAM_UNLOCKALL", "1") != "0"

        mod_metadata_dir.mkdir(parents=True, exist_ok=True)
        log_dir.mkdir(parents=True, exist_ok=True)
        crash_dir.mkdir(parents=True, exist_ok=True)

        with backed_up_file(dlc_load_file), backed_up_file(mod_metadata_file), backed_up_file(cream_api_ini):
            write_mod_metadata(descriptor, mod_dir, mod_metadata_file)
            seed_dlc_state(normal_game_data, game_data_dir, dlc_load_file)
            set_cream_unlockall(cream_api_ini, cream_unlockall)

            print(
                "hoi4-smoke-windows: start "
                f"timeout={smoke_timeout} tag={smoke_tag} launcher={hoi4_exe.name}",
                flush=True,
            )
            print(f"hoi4-smoke-windows: data {game_data_dir}", flush=True)
            print(f"hoi4-smoke-windows: temp {smoke_root}", flush=True)
            if cream_api_ini.is_file():
                print(f"hoi4-smoke-windows: cream unlockall={str(cream_unlockall).lower()}", flush=True)

            run_status = run_hoi4(
                hoi4_exe=hoi4_exe,
                hoi4_dir=hoi4_dir,
                crash_dir=crash_dir,
                smoke_tag=smoke_tag,
                timeout_seconds=parse_duration(smoke_timeout),
                launch_log=launch_log,
            )

        if run_status not in (0, 124):
            print(f"hoi4-smoke-windows: HOI4 exited with status {run_status}; checking logs anyway")

        if not error_log.is_file():
            die(f"HOI4 did not create logs/error.log in user-data dir: {game_data_dir}")
        if previous_error_log_mtime is not None and error_log.stat().st_mtime <= previous_error_log_mtime:
            die(f"HOI4 did not update logs/error.log in user-data dir: {game_data_dir}")

        entries, ignored_entries = classify_errors(error_log, include_pattern)
        matches_file.write_text("\n\n".join(entries) + ("\n" if entries else ""))

        if entries:
            keep_data = True
            print_failure_summary(
                entries=entries,
                ignored_entries=ignored_entries,
                error_log=error_log,
                smoke_root=smoke_root,
                max_entries=max_error_entries,
                max_entry_lines=max_entry_lines,
            )
            return 1

        if run_status not in (0, 124):
            die(f"HOI4 exited with status {run_status}, but no serious error pattern was found")

        if keep_data:
            print(f"hoi4-smoke-windows: PASS; retained data: {smoke_root}")
        else:
            print("hoi4-smoke-windows: PASS")
        return 0
    finally:
        if not keep_data and smoke_root.exists():
            shutil.rmtree(smoke_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
