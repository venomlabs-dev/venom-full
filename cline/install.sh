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
# Cline runs one TaskStart and one PostToolUse file per hooks folder: never
# overwrite one that isn't ours (ours mention venom-cline.sh).
for f in TaskStart PostToolUse; do
  if [ -f "$target/$f" ] && ! grep -q "venom-cline.sh" "$target/$f" 2>/dev/null; then
    echo "Stopped: $target/$f already exists and is not Venom's. Cline allows only one $f hook file per folder," >&2
    echo "so nothing was changed. Merge by hand (call: sh venom-cline.sh $( [ "$f" = TaskStart ] && echo task-start || echo post-tool ) from your file)," >&2
    echo "move your file away, or install into another folder: sh install.sh <folder>" >&2
    exit 1
  fi
done
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
