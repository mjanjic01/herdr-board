#!/bin/sh
# sh board-heavy.test.sh: the slot logic of board-heavy.sh, in a scratch home.
set -u
here=$(cd "$(dirname "$0")" && pwd)
H=$(mktemp -d "${TMPDIR:-/tmp}/bh.XXXXXX"); export BOARD_HOME=$H BOARD_HEAVY_POLL=1 BOARD_HEAVY_SLOTS=1
fail=0; ok() { echo "ok - $1"; }; no() { echo "not ok - $1"; fail=1; }
bh() { sh "$here/board-heavy.sh" "$@"; }

# Exit code passes through, and the slot is free afterwards.
bh sh -c 'exit 7'; [ $? -eq 7 ] && ok "exit code passes through" || no "exit code passes through"
[ ! -L "$H/heavy/slot-1" ] && ok "slot freed after exit" || no "slot freed after exit"

# Runs at low priority.
n=$(bh sh -c 'ps -o ni= -p $$' | tr -d ' '); [ "$n" = 10 ] && ok "runs at nice 10" || no "runs at nice 10 (got $n)"

# A stale slot (dead pid) is taken over.
sh -c 'exit 0' & dead=$!; wait $dead
mkdir -p "$H/heavy"; ln -s "$dead:kold:rold:1" "$H/heavy/slot-1"
out=$(bh echo ran); [ "$out" = ran ] && ok "stale slot taken over" || no "stale slot taken over"
[ ! -L "$H/heavy/slot-1" ] && ok "stale slot gone after the run" || no "stale slot gone after the run"

# A busy slot makes the second job wait, with a wait marker, until the first ends.
BOARD_TASK=kfirst sh "$here/board-heavy.sh" sh -c 'sleep 3' & first=$!
sleep 1
start=$(date +%s)
BOARD_TASK=ksecond sh "$here/board-heavy.sh" sh -c 'echo second' > "$H/second.out" & second=$!
sleep 1
ls "$H/heavy"/wait-* >/dev/null 2>&1 && ok "waiting job leaves a marker" || no "waiting job leaves a marker"
grep -q ':ksecond:' "$H/heavy"/wait-* 2>/dev/null && ok "marker names the waiting task" || no "marker names the waiting task"
case "$(readlink "$H/heavy/slot-1")" in *:kfirst:*) ok "slot names its holder";; *) no "slot names its holder";; esac
wait $first; wait $second
took=$(( $(date +%s) - start ))
[ "$(cat "$H/second.out")" = second ] && [ "$took" -ge 2 ] && ok "second job ran after the first" || no "second job ran after the first (took $took s)"
ls "$H/heavy"/wait-* >/dev/null 2>&1 && no "marker removed" || ok "marker removed"

# A signal frees the slot.
sh "$here/board-heavy.sh" sleep 30 & sig=$!
sleep 1; kill -TERM $sig; wait $sig 2>/dev/null
sleep 1; [ ! -L "$H/heavy/slot-1" ] && ok "slot freed on TERM" || no "slot freed on TERM"
pgrep -f "sleep 30" >/dev/null && no "job stopped on TERM" || ok "job stopped on TERM"

# Two slots: two jobs at once.
BOARD_HEAVY_SLOTS=2 sh "$here/board-heavy.sh" sleep 2 & a=$!; sleep 0.5
start=$(date +%s); BOARD_HEAVY_SLOTS=2 bh true; took=$(( $(date +%s) - start ))
[ "$took" -le 1 ] && ok "a second slot runs at once" || no "a second slot runs at once"
wait $a
rm -rf "$H"; exit $fail
