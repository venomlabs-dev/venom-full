#!/bin/sh
# Installs the Venom hook files for Cline (CLI and VS Code extension).
#
#   sh install.sh [target-dir]
#
# Default target: ~/Documents/Cline/Hooks, which both the Cline CLI and the
# VS Code extension read for every project. For one project only, use
# <project>/.cline/hooks (CLI) or <project>/.clinerules/hooks (VS Code).
# Run from a clone of venomlabs-dev/venom-full, or pipe it from curl and it
# downloads the files itself.
set -e
target=${1:-"$HOME/Documents/Cline/Hooks"}
files="TaskStart PostToolUse venom-cline.sh venom-hook.sh"
src=""
if [ -n "$0" ] && [ -f "$(dirname "$0")/hooks/venom-hook.sh" ]; then src="$(dirname "$0")/hooks"; fi
mkdir -p "$target"
for f in $files; do
  if [ -n "$src" ]; then
    cp "$src/$f" "$target/$f"
  else
    curl -fsSL "https://raw.githubusercontent.com/venomlabs-dev/venom-full/main/cline/hooks/$f" -o "$target/$f"
  fi
  chmod +x "$target/$f"
done
echo "Venom hooks installed in $target"
echo "VS Code: turn on Enable Hooks in Cline's settings (Feature Settings)."
echo "CLI: hooks are off in --yolo mode; use --act or --plan."
