---
name: herdr-board
description: Read and change the Herdr kanban boards on this machine. Use it to add a task or work to the board, hand something to the board team, or check the board. Also use it to move or assign a board task, or add a note to one. Works through ~/.herdr/board/ (board.json and inbox/).
---

# The Herdr board

This machine runs a board engine. It keeps one board per checkout (a
repository or worktree folder) and a library of teams. You talk to it through
files in `~/.herdr/board/`.

1. Read `~/.herdr/board/README.md`. It explains the folder, the request format
   and the answers.
2. Read `~/.herdr/board/board.json` for the boards, their teams and member
   names, the column ids and the current tasks.
3. To add or change a task, write one JSON request to
   `~/.herdr/board/inbox/`: write a dot-named temp file, then rename it to
   `<unique name>.json`. Name the board by `folder`: the absolute path of the
   repository or worktree. Use member names from that board's team.
4. Wait about 2 seconds. Then read `inbox/done/<name>.json` or
   `inbox/failed/<name>.json`, and tell the person what happened.

You can be a member of the board team: your first message then says that the
Herdr board coordinates you. In that case, write requests only when the
person asks.
