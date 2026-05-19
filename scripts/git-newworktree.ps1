param(
    [Parameter(Mandatory = $true)]
    [string]$Branch,

    [string]$WorktreePath = "",

    [switch]$CopyEnv = $true,
    [switch]$CopyNodeModules = $true,
    [switch]$CopyPiCache = $true,
    [switch]$UseSymlinks = $true
)

<#
.SYNOPSIS
    Creates a git worktree and copies additional files (like symlinks/caches/configs).

.DESCRIPTION
    Git worktrees only contain tracked files. This script creates the worktree and
    then copies or symlinks extra files/folders from the main repo into it:
      - .env files
      - node_modules (or .pnpm store references)
      - .pi/rag-cache.json (pi agent cache)
      - any custom items in $ExtraItems

.PARAMETER Branch
    Branch name to check out in the new worktree.

.PARAMETER WorktreePath
    Optional. Where to create the worktree. Default: ../<repo>.worktrees/<Branch>

.PARAMETER CopyEnv
    Copy .env files from main repo.

.PARAMETER CopyNodeModules
    Copy or symlink node_modules.

.PARAMETER CopyPiCache
    Copy or symlink .pi/rag-cache.json.

.PARAMETER UseSymlinks
    Use symlinks instead of copying (faster, saves space, but cache files must be
    read-only in the worktree if you want to avoid cross-contamination).

.EXAMPLE
    .\scripts\git-newworktree.ps1 -Branch my-feature

.EXAMPLE
    .\scripts\git-newworktree.ps1 -Branch my-feature -UseSymlinks:$false -CopyEnv:$false
#>

# --- Config ---
# Paths relative to repo root that should also appear in new worktrees.
# You can edit this list freely.
$ExtraItems = @(
    # ".env",
    # ".env.local",
    # ".env.development",
    # "node_modules",
    ".pi/rag-cache.json",
    "scripts/mcp/node_modules",
    ".pnpm-store"   # only if you keep a local .pnpm-store
)

# --- Resolve paths ---
$MainRepo = (git rev-parse --show-toplevel)
if (-not $MainRepo) {
    Write-Error "Not inside a git repository."
    exit 1
}
$MainRepo = (Resolve-Path $MainRepo).Path

if (-not $WorktreePath) {
    # default: <parent_dir>/<repo>.worktrees/<branch>
    $RepoDir = Split-Path $MainRepo -Leaf
    $ParentDir = Split-Path $MainRepo -Parent
    $WorktreePath = Join-Path $ParentDir "$RepoDir.worktrees" $Branch
}

# --- 1. Create worktree ---
Write-Host ">>> Creating worktree at: $WorktreePath" -ForegroundColor Cyan
git worktree add $WorktreePath $Branch
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create worktree."
    exit 1
}

# --- 2. Copy / symlink extra files ---
Write-Host ">>> Copying extra files..." -ForegroundColor Cyan

function Copy-WithSymlink {
    param(
        [string]$Source,
        [string]$Dest
    )
    $Source = $Source.Replace('/', '\')
    $Dest = $Dest.Replace('/', '\')

    if (-not (Test-Path $Source)) {
        Write-Host "    [SKIP] $Source — not found in main repo" -ForegroundColor DarkYellow
        return
    }

    if (Test-Path $Dest) {
        Write-Host "    [SKIP] $Dest — already exists in worktree" -ForegroundColor DarkYellow
        return
    }

    # Ensure parent directory exists
    $DestDir = Split-Path $Dest -Parent
    if (-not (Test-Path $DestDir)) {
        New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    }

    if ($UseSymlinks) {
        # Use relative symlink
        $RelPath = Resolve-Path -Path $Source -RelativeBase $DestDir
        # Actually, RelativeBase doesn't exist in PS < 7. Let's do it manually.
        $SourceFull = (Resolve-Path $Source).Path
        try {
            New-Item -ItemType SymbolicLink -Path $Dest -Target $SourceFull -ErrorAction Stop | Out-Null
            Write-Host "    [SYMLINK] $Source -> $Dest" -ForegroundColor Green
        }
        catch {
            Write-Host "    [FAIL] Symlink failed, trying copy..." -ForegroundColor Yellow
            Copy-Item -Recurse -Path $Source -Destination $Dest -Force
            Write-Host "    [COPY] $Source -> $Dest" -ForegroundColor Green
        }
    }
    else {
        Copy-Item -Recurse -Path $Source -Destination $Dest -Force
        Write-Host "    [COPY] $Source -> $Dest" -ForegroundColor Green
    }
}

# --- Built-in items ---
# .env files
if ($CopyEnv) {
    Get-ChildItem (Join-Path $MainRepo ".env*") -File | ForEach-Object {
        $rel = $_.Name
        $dest = Join-Path $WorktreePath $rel
        Copy-WithSymlink -Source $_.FullName -Dest $dest
    }
}

# node_modules
if ($CopyNodeModules) {
    Copy-WithSymlink -Source (Join-Path $MainRepo "node_modules") -Dest (Join-Path $WorktreePath "node_modules")
}

# .pi/rag-cache.json
if ($CopyPiCache) {
    Copy-WithSymlink -Source (Join-Path $MainRepo ".pi/rag-cache.json") -Dest (Join-Path $WorktreePath ".pi/rag-cache.json")
}

# Custom extra items
foreach ($item in $ExtraItems) {
    $src = Join-Path $MainRepo $item
    $dst = Join-Path $WorktreePath $item
    Copy-WithSymlink -Source $src -Dest $dst
}

# --- 3. Done ---
Write-Host "`n>>> Worktree ready!" -ForegroundColor Cyan
Write-Host "    Path: $WorktreePath"
Write-Host "    Branch: $Branch"
Write-Host "`nTo switch to it in VS Code: code `"$WorktreePath`"" -ForegroundColor Gray
