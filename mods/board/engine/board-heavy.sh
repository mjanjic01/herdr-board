#!/bin/sh
# board-heavy <command...>
# Runs a heavy browser job (an e2e or Playwright suite) in one of this
# machine's slots, at low priority. While every slot is taken it waits, and the
# board shows "Waits for a browser slot" on the task's card.
# A slot is a symlink $BOARD_HOME/heavy/slot-N whose target is
# "<pid>:<task>:<run>:<start>": creating it is atomic, and a slot whose pid is
# gone is stale and taken over. The exit code is the command's.
[ $# -gt 0 ] || { echo "usage: board-heavy <command...>" >&2; exit 2; }
home=${BOARD_HOME:-$HOME/.herdr/board}
slots=${BOARD_HEAVY_SLOTS:-1}
nice_n=${BOARD_HEAVY_NICE:-10}
poll=${BOARD_HEAVY_POLL:-3}
dir=$home/heavy
mkdir -p "$dir" || exit 1
me=$$
info="$me:${BOARD_TASK:-}:${BOARD_RUN:-}:$(date +%s)"
held=
wait_file=$dir/wait-$me

alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
release() {
  [ -n "$held" ] && [ "$(readlink "$held" 2>/dev/null)" = "$info" ] && rm -f "$held"
  held=
  rm -f "$wait_file"
}
child=
# A signal stops the job too, and frees the slot at once (a foreground job
# would hold the trap until it ends).
stop() { [ -n "$child" ] && kill -TERM "$child" 2>/dev/null; release; exit "$1"; }
trap 'release' EXIT
trap 'stop 130' INT
trap 'stop 143' TERM
trap 'stop 129' HUP

# One pass over the slots: 0 when one is ours.
take() {
  i=1
  while [ "$i" -le "$slots" ]; do
    s=$dir/slot-$i
    if ln -s "$info" "$s" 2>/dev/null; then held=$s; return 0; fi
    owner=$(readlink "$s" 2>/dev/null)
    if [ -n "$owner" ] && ! alive "${owner%%:*}"; then
      # Stale: move it aside, and drop it only if it is still the stale one.
      if mv "$s" "$s.old.$me" 2>/dev/null; then
        if [ "$(readlink "$s.old.$me" 2>/dev/null)" = "$owner" ]; then rm -f "$s.old.$me"; continue; fi
        [ -e "$s" ] || [ -L "$s" ] || mv "$s.old.$me" "$s" 2>/dev/null
        rm -f "$s.old.$me"
      fi
    fi
    i=$((i + 1))
  done
  return 1
}

if ! take; then
  printf '%s\n' "$info" > "$wait_file"
  echo "board-heavy: waiting for a browser slot on this machine…" >&2
  until take; do sleep "$poll"; done
  rm -f "$wait_file"
fi
# A sandbox (Codex) may refuse a lower priority: then run it as it is, quietly.
if [ "$nice_n" -gt 0 ] 2>/dev/null && [ -z "$(nice -n "$nice_n" true 2>&1)" ]; then nice -n "$nice_n" "$@" <&0 & else "$@" <&0 & fi
child=$!
wait "$child"
rc=$?
child=
release
exit $rc
