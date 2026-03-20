#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 /path/to/vanilla_old /path/to/vanilla_new /path/to/mod"
  exit 1
fi

VOLD="$1"
VNEW="$2"
MOD="$3"

# safety
#TIMESTAMP=$(date +%Y%m%d%H%M%S)
#BACKUP="${MOD}_backup_${TIMESTAMP}"
#echo "Creating backup of mod -> ${BACKUP}"
#mkdir -p "$BACKUP"
#cp -a "$MOD/." "$BACKUP/"

# Find files that are Modified or Renamed between vanilla_old and vanilla_new
# We exclude purely added files in new vanilla (we don't want to create new files in mod)
mapfile -t files < <(
  git diff --no-index --name-status --diff-filter=MR -- "$VOLD" "$VNEW" \
  | awk '{ if ($1 ~ /^R/) print $3; else print $2 }' \
  | sed -E "s#^.*/vanilla_old/##"
)

if [ "${#files[@]}" -eq 0 ]; then
  echo "No modified/renamed files between vanilla versions (or git not available). Exiting."
  exit 0
fi

echo "Files changed in vanilla (filtered to M/R):"
printf '%s\n' "${files[@]}"

# Process each file: if it exists in mod, try a 3-way merge: ours=mod, base=vanilla_old, theirs=vanilla_new
for f in "${files[@]}"; do
  # normalize path separators
  f="$(printf '%s' "$f" | sed 's#\\#/#g')"
  modfile="$MOD/$f"
  basefile="$VOLD/$f"
  newfile="$VNEW/$f"
  
  if [ -f "$modfile" ]; then
    echo "Merging: $f (present in mod) ..."
    # ensure base and new exist
    if [ ! -f "$basefile" ] || [ ! -f "$newfile" ]; then
      echo "  Warning: base or new missing for $f — skipping automatic 3-way merge."
      continue
    fi

    # Use git-merge-file for three-way merge (inplace).
    # It modifies the 'modfile' and leaves conflict markers if conflicts occur.
    # We'll work on a temp copy and then replace the modfile on success (or with conflict markers)
    tmp="$modfile.merge_tmp"
    cp -a "$modfile" "$tmp"
    # git-merge-file: OURS BASE THEIRS
    git merge-file -p "$tmp" "$basefile" "$newfile" > "$tmp.merged" || true
    mv "$tmp.merged" "$modfile"
    rm -f "$tmp"
    # Report if conflict markers are present
    if grep -q '^<<<<<<< ' "$modfile"; then
      echo "  Conflict markers left in $modfile — please resolve manually."
    else
      echo "  Merged successfully: $modfile"
    fi

  else
    echo "Skipping $f — not present in mod (we don't add new vanilla files)."
  fi
done

echo "Done. Backup of mod saved at ${BACKUP}."
echo "Review changes in $MOD, resolve conflicts, then commit."