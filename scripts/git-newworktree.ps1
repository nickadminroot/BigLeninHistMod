param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Branch,

    [string]$WorktreePath = "",

    [switch]$CopyEnv = $true,
    [switch]$CopyNodeModules = $true,
    [switch]$CopyPiCache = $true,
    [switch]$UseSymlinks = $true
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$WorktreeCreated = $false

trap {
    [Console]::Error.WriteLine("git-newworktree: ERROR: {0}", $_.Exception.Message)
    if ($WorktreeCreated -and $WorktreePath) {
        [Console]::Error.WriteLine("git-newworktree: worktree remains registered at: {0}", $WorktreePath)
        [Console]::Error.WriteLine("git-newworktree: inspect it before retrying; no automatic cleanup was attempted.")
    }
    exit 1
}

<#
.SYNOPSIS
    Creates a git worktree and copies additional files (like symlinks/caches/configs).

.DESCRIPTION
    Git worktrees only contain tracked files. This script creates the worktree and
    then copies or symlinks extra files/folders from the main repo into it:
      - .env files
      - node_modules (or .pnpm store references)
      - .cache/docs-search/rag-cache.json (standalone docs-search cache)
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
    Copy or symlink .cache/docs-search/rag-cache.json. The switch retains its legacy CopyPiCache name for compatibility.

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
    "scripts/mcp/node_modules",
    ".pnpm-store"   # only if you keep a local .pnpm-store
)

# --- Resolve and validate paths ---
$MainRepo = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or -not $MainRepo) {
    throw "Not inside a git repository."
}
$MainRepo = (Resolve-Path -LiteralPath $MainRepo).Path

# Validate the branch before creating any directories. The helper intentionally
# checks out an existing task branch; branch creation stays an explicit Git step.
git check-ref-format --branch $Branch *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Invalid branch name: $Branch"
}
git show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -ne 0) {
    throw "Local branch does not exist: $Branch. Create it before running this helper."
}

if (-not $WorktreePath) {
    # Default: <parent_dir>/<repo>.worktrees/<branch>. Use nested Join-Path calls
    # for compatibility with Windows PowerShell 5.1.
    $RepoDir = Split-Path -Path $MainRepo -Leaf
    $ParentDir = Split-Path -Path $MainRepo -Parent
    $WorktreeRoot = Join-Path -Path $ParentDir -ChildPath "$RepoDir.worktrees"
    $WorktreePath = Join-Path -Path $WorktreeRoot -ChildPath $Branch
}
elseif (-not [System.IO.Path]::IsPathRooted($WorktreePath)) {
    $WorktreePath = Join-Path -Path $MainRepo -ChildPath $WorktreePath
}
$WorktreePath = [System.IO.Path]::GetFullPath($WorktreePath)

$RepoPrefix = $MainRepo.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if ($WorktreePath.Equals($MainRepo, [System.StringComparison]::OrdinalIgnoreCase) -or
    $WorktreePath.StartsWith($RepoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Worktree path must be outside the main repository: $WorktreePath"
}
if (Test-Path -LiteralPath $WorktreePath) {
    throw "Worktree destination already exists: $WorktreePath"
}

# --- 1. Create worktree ---
Write-Host ">>> Creating worktree at: $WorktreePath" -ForegroundColor Cyan
git worktree add $WorktreePath $Branch
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create worktree."
}
$WorktreeCreated = $true

# --- 2. Copy / symlink extra files ---
Write-Host ">>> Copying extra files..." -ForegroundColor Cyan

function Copy-WithSymlink {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Dest
    )

    $Source = $Source.Replace('/', '\')
    $Dest = $Dest.Replace('/', '\')

    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Host "    [SKIP] $Source - not found in main repo" -ForegroundColor DarkYellow
        return
    }

    if (Test-Path -LiteralPath $Dest) {
        Write-Host "    [SKIP] $Dest - already exists in worktree" -ForegroundColor DarkYellow
        return
    }

    $DestDir = Split-Path -Path $Dest -Parent
    if (-not (Test-Path -LiteralPath $DestDir)) {
        New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    }

    if ($UseSymlinks) {
        $SourceFull = (Resolve-Path -LiteralPath $Source).Path
        try {
            New-Item -ItemType SymbolicLink -Path $Dest -Target $SourceFull -ErrorAction Stop | Out-Null
            Write-Host "    [SYMLINK] $Source -> $Dest" -ForegroundColor Green
            return
        }
        catch {
            Write-Host "    [WARN] Symlink failed; copying instead: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    Copy-Item -Recurse -LiteralPath $Source -Destination $Dest -Force -ErrorAction Stop
    Write-Host "    [COPY] $Source -> $Dest" -ForegroundColor Green
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

# docs-search cache
if ($CopyPiCache) {
    Copy-WithSymlink -Source (Join-Path $MainRepo ".cache/docs-search/rag-cache.json") -Dest (Join-Path $WorktreePath ".cache/docs-search/rag-cache.json")
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
