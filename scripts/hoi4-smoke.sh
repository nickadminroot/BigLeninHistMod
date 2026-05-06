#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MOD_DIR="$REPO_ROOT/BigLeninHistMod"
MOD_NAME="BigLeninHistMod"
REAL_HOME="$HOME"

HOI4_DIR="${HOI4_DIR:-$REAL_HOME/.steam/steam/steamapps/common/Hearts of Iron IV}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-120s}"
SMOKE_TAG="${SMOKE_TAG:-GER}"
SMOKE_MAX_MATCH_LINES="${SMOKE_MAX_MATCH_LINES:-200}"
HOI4_SMOKE_KEEP_DATA="${HOI4_SMOKE_KEEP_DATA:-0}"

RUN_HOI4="$HOI4_DIR/run_hoi4"
DESCRIPTOR="$MOD_DIR/descriptor.mod"

die() {
    printf 'hoi4-smoke: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    if [[ "${KEEP_DATA_EFFECTIVE:-0}" != "1" && -n "${SMOKE_ROOT:-}" && -d "$SMOKE_ROOT" ]]; then
        rm -rf -- "$SMOKE_ROOT"
    fi
}

require_file() {
    [[ -f "$1" ]] || die "missing required file: $1"
}

require_executable() {
    [[ -x "$1" ]] || die "missing executable: $1"
}

if [[ -n "${PDX_SMOKE_HOME:-}" ]]; then
    SMOKE_ROOT="$PDX_SMOKE_HOME"
    KEEP_DATA_EFFECTIVE=1
else
    SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hoi4-smoke.XXXXXX")" || die "could not create temporary data directory"
    KEEP_DATA_EFFECTIVE="$HOI4_SMOKE_KEEP_DATA"
fi
trap cleanup EXIT

require_executable "$RUN_HOI4"
require_file "$DESCRIPTOR"

FAKE_HOME="$SMOKE_ROOT/home"
FAKE_XDG_DATA_HOME="$FAKE_HOME/.local/share"
GAME_DATA_DIR="$FAKE_XDG_DATA_HOME/Paradox Interactive/Hearts of Iron IV"
MOD_METADATA_DIR="$GAME_DATA_DIR/mod"
LOG_DIR="$GAME_DATA_DIR/logs"
MOD_METADATA_FILE="$MOD_METADATA_DIR/$MOD_NAME.mod"
DLC_LOAD_FILE="$GAME_DATA_DIR/dlc_load.json"
ERROR_LOG="$LOG_DIR/error.log"

mkdir -p -- "$MOD_METADATA_DIR" "$LOG_DIR" "$FAKE_HOME/.local/share" \
    || die "could not create isolated game data directories"

if [[ -e "$REAL_HOME/.steam" && ! -e "$FAKE_HOME/.steam" ]]; then
    ln -s -- "$REAL_HOME/.steam" "$FAKE_HOME/.steam" \
        || die "could not link Steam config into isolated home"
fi

if [[ -e "$REAL_HOME/.local/share/Steam" && ! -e "$FAKE_XDG_DATA_HOME/Steam" ]]; then
    ln -s -- "$REAL_HOME/.local/share/Steam" "$FAKE_XDG_DATA_HOME/Steam" \
        || die "could not link Steam data into isolated home"
fi

{
    sed '/^[[:space:]]*path[[:space:]]*=/d' "$DESCRIPTOR"
    printf '\npath="%s"\n' "$MOD_DIR"
} > "$MOD_METADATA_FILE" || die "could not write temporary mod metadata"

printf '{"enabled_mods":["mod/%s.mod"],"disabled_dlcs":[]}\n' "$MOD_NAME" > "$DLC_LOAD_FILE" \
    || die "could not write temporary dlc_load.json"

printf 'hoi4-smoke: game dir: %s\n' "$HOI4_DIR"
printf 'hoi4-smoke: mod dir: %s\n' "$MOD_DIR"
printf 'hoi4-smoke: isolated data: %s\n' "$GAME_DATA_DIR"
printf 'hoi4-smoke: timeout: %s, start tag: %s\n' "$SMOKE_TIMEOUT" "$SMOKE_TAG"

(
    cd -- "$HOI4_DIR" || exit 125
    HOME="$FAKE_HOME" \
    LINUX_DATA_HOME="$FAKE_XDG_DATA_HOME" \
    XDG_DATA_HOME="$FAKE_XDG_DATA_HOME" \
    timeout "$SMOKE_TIMEOUT" "$RUN_HOI4" \
        -gdpr-compliant \
        -debug_mode \
        "-start_tag=$SMOKE_TAG" \
        "-userdir=$GAME_DATA_DIR" \
        "--crashdir=$GAME_DATA_DIR/crashes"
)
run_status=$?

case "$run_status" in
    0|124|143)
        ;;
    125)
        die "could not enter HOI4_DIR: $HOI4_DIR"
        ;;
    *)
        printf 'hoi4-smoke: HOI4 exited with status %s; checking logs anyway\n' "$run_status" >&2
        ;;
esac

if [[ ! -f "$ERROR_LOG" ]]; then
    die "HOI4 did not create logs/error.log in isolated data dir: $GAME_DATA_DIR"
fi

pattern='Error:|Invalid trigger|Invalid effect|Unexpected token|Couldn'\''t find texture|Missing texture|MAP_ERROR'
matching_line_count="$(grep -En "$pattern" "$ERROR_LOG" | wc -l)"
matches="$(grep -En -C 2 "$pattern" "$ERROR_LOG" | sed -n "1,${SMOKE_MAX_MATCH_LINES}p" || true)"

if [[ "$matching_line_count" -gt 0 ]]; then
    printf 'hoi4-smoke: serious startup/load errors found in %s\n' "$ERROR_LOG" >&2
    printf 'hoi4-smoke: matching error lines: %s\n' "$matching_line_count" >&2
    printf '%s\n' "$matches" >&2
    if [[ "$matching_line_count" -gt "$SMOKE_MAX_MATCH_LINES" ]]; then
        printf 'hoi4-smoke: output truncated to %s lines; inspect the retained error.log for full details\n' "$SMOKE_MAX_MATCH_LINES" >&2
    fi
    printf 'hoi4-smoke: isolated data retained at %s\n' "$SMOKE_ROOT" >&2
    KEEP_DATA_EFFECTIVE=1
    exit 1
fi

if [[ "$run_status" != "0" && "$run_status" != "124" && "$run_status" != "143" ]]; then
    die "HOI4 exited with status $run_status, but no configured serious error pattern was found"
fi

if [[ "$KEEP_DATA_EFFECTIVE" == "1" ]]; then
    printf 'hoi4-smoke: passed; isolated data retained at %s\n' "$SMOKE_ROOT"
else
    printf 'hoi4-smoke: passed\n'
fi
