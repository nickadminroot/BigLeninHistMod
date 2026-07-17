@echo off
REM Install Node.js dependencies for HOI4 MCP CLI tools.
REM Run this once after cloning/installing the skill.

set SCRIPT_DIR=%~dp0
set MCP_DIR=%SCRIPT_DIR%mcp

echo Installing MCP server dependencies...
cd /d "%MCP_DIR%"
if %ERRORLEVEL% neq 0 (
    echo Error: %MCP_DIR% not found
    exit /b 1
)

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: npm not found. Install Node.js first.
    echo   https://nodejs.org/
    exit /b 1
)

echo Running: npm install
echo.
call npm install

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: npm install failed. Check the output above.
    echo Common fixes:
    echo   1. Check internet connection
    echo   2. Update Node.js: https://nodejs.org/
    echo   3. Clear npm cache: npm cache clean --force
    echo   4. Check package.json for issues
    exit /b 1
)

echo.
echo Done. Dependencies installed in %MCP_DIR%\node_modules\
echo.
echo Usage:
echo   node scripts\hoi4-mcp-cli.js --list           # List all tools
echo   node scripts\hoi4-mcp-cli.js --help            # Help
echo   node scripts\hoi4-mcp-cli.js script_search --pattern "has_idea"
