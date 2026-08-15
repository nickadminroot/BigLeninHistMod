# Updating the Steam Workshop item

## Paths

- SteamCMD: `D:\SteamCMD\steamcmd.exe`
- Workshop build VDF: `scripts/hoi4_upload.vdf`
- Uploaded mod content: `BigLeninHistMod/`
- Workshop item ID: `3683025629`

The VDF must keep `contentfolder` pointed at the inner `BigLeninHistMod/` directory, which contains `descriptor.mod`. Do not upload the repository root.

## Before uploading

1. Merge and validate the intended changes on `main`.
2. Update the `changenote` field in `scripts/hoi4_upload.vdf`.
3. Ensure the root `.env` contains `STEAM_USER` and `STEAM_PASS`. Never put credentials in the VDF or commit `.env`.
4. Confirm `BigLeninHistMod/thumbnail.png` exists.

## Upload from WSL

The repository is stored in WSL at `~/projects/BigLeninHistMod`, while SteamCMD remains a Windows executable. Run from the repository root:

```bash
set -a
. <(sed 's/\r$//' ./.env)  # Strip CR from CRLF files before Bash sourcing.
set +a
STEAMCMD="${STEAMCMD:-/mnt/d/SteamCMD/steamcmd.exe}"
VDF_WIN="$(wslpath -w ./scripts/hoi4_upload.vdf)"
"$STEAMCMD" +login "$STEAM_USER" "$STEAM_PASS" +workshop_build_item "$VDF_WIN" +quit
```

The VDF uses the Windows UNC path of the WSL checkout. If the repository is moved again, regenerate its `contentfolder` and `previewfile` values with `wslpath -w` before uploading. Keep the CR-stripping step: sourcing a CRLF `.env` directly from WSL appends `\r` to the Steam credentials and SteamCMD reports `Invalid Password`.

## Upload from native PowerShell

The WSL checkout is visible to Windows through an UNC path:

```powershell
Set-Location "\\wsl.localhost\Ubuntu\home\nickadminroot\projects\BigLeninHistMod"

Get-Content .env | ForEach-Object {
    if ($_ -match "^(STEAM_USER|STEAM_PASS)=(.*)$") {
        Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
    }
}

& "D:\SteamCMD\steamcmd.exe" "+login" $env:STEAM_USER $env:STEAM_PASS "+workshop_build_item" "\\wsl.localhost\Ubuntu\home\nickadminroot\projects\BigLeninHistMod\scripts\hoi4_upload.vdf" "+quit"
```

A Steam Guard mobile authenticator requires confirmation in the Steam Mobile app on every login. Confirm it while SteamCMD is waiting; otherwise it times out and the upload fails.

## Result

A successful SteamCMD upload updates Workshop item `3683025629`. If the command fails, inspect `D:\SteamCMD\logs\stderr.txt` and do not claim that the Workshop page was updated.
