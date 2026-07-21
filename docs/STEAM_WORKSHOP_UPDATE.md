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

## Upload from native PowerShell

Run from the repository root:

```powershell
Set-Location "G:\Documents\Paradox Interactive\Hearts of Iron IV\mod\BigLeninHistMod"

Get-Content .env | ForEach-Object {
    if ($_ -match "^(STEAM_USER|STEAM_PASS)=(.*)$") {
        Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
    }
}

& "D:\SteamCMD\steamcmd.exe" "+login" $env:STEAM_USER $env:STEAM_PASS "+workshop_build_item" "G:\Documents\Paradox Interactive\Hearts of Iron IV\mod\BigLeninHistMod\scripts\hoi4_upload.vdf" "+quit"
```

A Steam Guard mobile authenticator requires confirmation in the Steam Mobile app on every login. Confirm it while SteamCMD is waiting; otherwise it times out and the upload fails.

## Result

A successful SteamCMD upload updates Workshop item `3683025629`. If the command fails, inspect `D:\SteamCMD\logs\stderr.txt` and do not claim that the Workshop page was updated.
