# Terminal pet, bash integration. Source this file from ~/.bashrc:
#
#   source /path/to/06-terminal-pet/pet.sh
#   PS1='$PET_MOOD \w \$ '            # single quotes: expanded at prompt time
#
# Before every prompt PROMPT_COMMAND refreshes $PET_MOOD with a small face
# such as (^_^), wrapped in the \001 and \002 markers bash uses for
# zero-width colour codes. Reads one cached JSON file, never runs git.

PET_PY="${PET_PY:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pet.py}"

_pet_precmd() {
  PET_MOOD="$(python3 -S "$PET_PY" prompt --bash 2>/dev/null)"
}

case ";${PROMPT_COMMAND:-};" in
  *";_pet_precmd;"*) ;;                       # already installed
  *) PROMPT_COMMAND="_pet_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
