#!/bin/sh
# Symlink pet.py into ~/.local/bin as `pet` and print the shell lines to add.
# This script never edits your shell configuration files.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${HOME}/.local/bin"
mkdir -p "$BIN"
chmod +x "$HERE/pet.py"
ln -sf "$HERE/pet.py" "$BIN/pet"
echo "linked $BIN/pet -> $HERE/pet.py"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "note: $BIN is not on your PATH; add   export PATH=\"$BIN:\$PATH\"" ;;
esac
cat <<MSG

Add these lines to ~/.zshrc (zsh, the macOS default):

  source $HERE/pet.zsh
  setopt PROMPT_SUBST
  RPROMPT='\${PET_MOOD}'

Or to ~/.bashrc (bash):

  source $HERE/pet.sh
  PS1='\$PET_MOOD \\w \\$ '

Then open a new shell and run:  pet
MSG
