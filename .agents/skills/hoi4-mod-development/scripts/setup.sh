#!/bin/bash
# Install Node.js dependencies for HOI4 MCP CLI tools.
# Run this once after cloning/installing the skill.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_DIR="$SCRIPT_DIR/mcp"

echo "Installing MCP server dependencies..."
cd "$MCP_DIR" || { echo "Error: $MCP_DIR not found"; exit 1; }

if ! command -v npm &> /dev/null; then
    echo "Error: npm not found. Install Node.js first."
    echo "  https://nodejs.org/"
    exit 1
fi

echo "Running: npm install"
echo ""
npm install

if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: npm install failed. Check the output above."
    echo "Common fixes:"
    echo "  1. Check internet connection"
    echo "  2. Update Node.js: https://nodejs.org/"
    echo "  3. Clear npm cache: npm cache clean --force"
    echo "  4. Check package.json for issues"
    exit 1
fi

echo ""
echo "Done. Dependencies installed in $MCP_DIR/node_modules/"
echo ""
echo "Usage:"
echo "  node scripts/hoi4-mcp-cli.js --list           # List all tools"
echo "  node scripts/hoi4-mcp-cli.js --help            # Help"
echo "  node scripts/hoi4-mcp-cli.js script_search --pattern 'has_idea'"
