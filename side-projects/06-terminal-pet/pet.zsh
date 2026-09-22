# Terminal pet, zsh integration. Source this file from ~/.zshrc:
#
#   source /path/to/06-terminal-pet/pet.zsh
#   setopt PROMPT_SUBST
#   RPROMPT='${PET_MOOD}'            # or put ${PET_MOOD} anywhere in PROMPT
#
# Before every prompt the hook refreshes $PET_MOOD with a small face such as
# (^_^). The call reads one cached JSON file and never runs git, so it costs
# about one Python start-up (roughly 20 ms). Git is rescanned in the
# background at most every few minutes.

# Resolve pet.py next to this file, so no PATH lookup or symlink is needed.
PET_PY="${PET_PY:-${${(%):-%x}:A:h}/pet.py}"

_pet_precmd() {
  # -S skips site-packages for a faster start; the pet needs only the stdlib.
  PET_MOOD="$(python3 -S "$PET_PY" prompt --zsh 2>/dev/null)"
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd _pet_precmd
