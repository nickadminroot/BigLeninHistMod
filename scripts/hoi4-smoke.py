#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


MOD_NAME = "BigLeninHistMod"
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
    print(f"hoi4-smoke: {message}", file=sys.stderr)
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


def require_executable(path: Path, label: str) -> None:
    if not path.is_file() or not os.access(path, os.X_OK):
        die(f"missing executable {label}: {path}")


def symlink_if_present(source: Path, target: Path) -> None:
    if source.exists() and not target.exists():
        target.symlink_to(source)


def write_mod_metadata(descriptor: Path, mod_dir: Path, output: Path) -> None:
    lines = descriptor.read_text(errors="replace").splitlines()
    without_path = [line for line in lines if not re.match(r"\s*path\s*=", line)]
    output.write_text("\n".join(without_path) + f'\npath="{mod_dir}"\n')


def seed_dlc_state(normal_data: Path, game_data: Path, dlc_load_file: Path) -> None:
    for filename in ("dlc_signature", "game_data.json"):
        source = normal_data / filename
        if source.is_file():
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


def run_hoi4(
    launch_cmd: list[str],
    hoi4_dir: Path,
    fake_home: Path,
    fake_xdg_data_home: Path,
    game_data_dir: Path,
    smoke_tag: str,
    timeout_seconds: float,
    launch_log: Path,
) -> int:
    command = [
        *launch_cmd,
        "-gdpr-compliant",
        "-debug_mode",
        "-debug",
        f"-start_tag={smoke_tag}",
        f"-userdir={game_data_dir}",
        f"--crashdir={game_data_dir / 'crashes'}",
    ]
    child_env = os.environ.copy()
    child_env.update(
        {
            "HOME": str(fake_home),
            "LINUX_DATA_HOME": str(fake_xdg_data_home),
            "XDG_DATA_HOME": str(fake_xdg_data_home),
        }
    )

    with launch_log.open("w", errors="replace") as log:
        proc = subprocess.Popen(
            command,
            cwd=hoi4_dir,
            env=child_env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            text=True,
        )
        try:
            return proc.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                return 124
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                code = proc.poll()
                if code is not None:
                    return 124
                time.sleep(0.1)
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
            return 124


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
    print("hoi4-smoke: FAIL serious startup/load errors", file=sys.stderr)
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


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    mod_dir = repo_root / MOD_NAME
    real_home = Path.home()

    hoi4_dir = Path(env("HOI4_DIR", str(real_home / ".steam/steam/steamapps/common/Hearts of Iron IV")))
    smoke_timeout = env("SMOKE_TIMEOUT", "60s")
    smoke_tag = env("SMOKE_TAG", "GER")
    keep_data_requested = env("HOI4_SMOKE_KEEP_DATA", "0") == "1"
    max_error_entries = int(env("SMOKE_MAX_ERROR_ENTRIES", "40"))
    max_entry_lines = int(env("SMOKE_MAX_ENTRY_LINES", "8"))
    include_pattern = os.environ.get("SMOKE_INCLUDE_PATTERN")

    run_hoi4_path = hoi4_dir / "run_hoi4"
    cream_wrapper = hoi4_dir / "cream.sh"
    descriptor = mod_dir / "descriptor.mod"
    normal_game_data = real_home / ".local/share/Paradox Interactive/Hearts of Iron IV"

    require_executable(run_hoi4_path, "run_hoi4")
    require_file(descriptor, "mod descriptor")

    fixed_smoke_home = os.environ.get("PDX_SMOKE_HOME")
    if fixed_smoke_home:
        smoke_root = Path(fixed_smoke_home)
        keep_data = True
        smoke_root.mkdir(parents=True, exist_ok=True)
    else:
        smoke_root = Path(tempfile.mkdtemp(prefix="hoi4-smoke."))
        keep_data = keep_data_requested

    try:
        fake_home = smoke_root / "home"
        fake_xdg_data_home = fake_home / ".local/share"
        game_data_dir = fake_xdg_data_home / "Paradox Interactive/Hearts of Iron IV"
        mod_metadata_dir = game_data_dir / "mod"
        log_dir = game_data_dir / "logs"
        mod_metadata_file = mod_metadata_dir / f"{MOD_NAME}.mod"
        dlc_load_file = game_data_dir / "dlc_load.json"
        error_log = log_dir / "error.log"
        launch_log = smoke_root / "hoi4-launch.log"
        matches_file = smoke_root / "matching-errors.txt"

        mod_metadata_dir.mkdir(parents=True, exist_ok=True)
        log_dir.mkdir(parents=True, exist_ok=True)
        fake_xdg_data_home.mkdir(parents=True, exist_ok=True)
        symlink_if_present(real_home / ".steam", fake_home / ".steam")
        symlink_if_present(real_home / ".local/share/Steam", fake_xdg_data_home / "Steam")

        write_mod_metadata(descriptor, mod_dir, mod_metadata_file)
        seed_dlc_state(normal_game_data, game_data_dir, dlc_load_file)

        launch_cmd = [str(run_hoi4_path)]
        if cream_wrapper.is_file() and os.access(cream_wrapper, os.X_OK):
            launch_cmd = [str(cream_wrapper), str(run_hoi4_path)]

        print(
            "hoi4-smoke: start "
            f"timeout={smoke_timeout} tag={smoke_tag} launcher={Path(launch_cmd[0]).name}",
            flush=True,
        )
        print(f"hoi4-smoke: data {game_data_dir}", flush=True)

        run_status = run_hoi4(
            launch_cmd=launch_cmd,
            hoi4_dir=hoi4_dir,
            fake_home=fake_home,
            fake_xdg_data_home=fake_xdg_data_home,
            game_data_dir=game_data_dir,
            smoke_tag=smoke_tag,
            timeout_seconds=parse_duration(smoke_timeout),
            launch_log=launch_log,
        )

        if run_status not in (0, 124, 143):
            print(f"hoi4-smoke: HOI4 exited with status {run_status}; checking logs anyway")

        if not error_log.is_file():
            die(f"HOI4 did not create logs/error.log in isolated data dir: {game_data_dir}")

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

        if run_status not in (0, 124, 143):
            die(f"HOI4 exited with status {run_status}, but no serious error pattern was found")

        if keep_data:
            print(f"hoi4-smoke: PASS; retained data: {smoke_root}")
        else:
            print("hoi4-smoke: PASS")
        return 0
    finally:
        if not keep_data and smoke_root.exists():
            shutil.rmtree(smoke_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
