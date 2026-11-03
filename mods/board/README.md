# Board

A kanban board for agents. Each checkout (a repository or worktree folder) has
its own board. A board uses one team from its machine's team library. The
members work on the tasks and hand each task to the next member.

## How it is built

The work runs in a board engine on each machine, not in this mod.

- `engine/engine.mjs` is the engine: one Node file with no dependencies. On
  each machine, the launchd user agent `dev.herdr.board` runs it. The engine
  starts the members through that machine's herdr-core and reads their
  results. It hands tasks on, picks up To do tasks, makes the task worktrees
  and answers requests. It works while the Herdr app is closed.
- `engine/README.md` is the guide for agents on each machine. The installer
  puts it next to the engine. `engine/SKILL.md` is the Claude Code skill
  `herdr-board`.
- `state.js` is the screen's client. It reads each engine's `state.json` and
  sends every change to the engine's `inbox/` as a request. The change shows
  on screen at once. When the engine lists it as applied, the screen shows
  the engine's state instead.
- `board.js`, `task.js`, `team.js` (the Teams window), `ui.js` and
  `mdeditor.js` are the screens.
- In the markdown editor (`mdeditor.js`), the two sides scroll together:
  scroll either one and the other shows the same part of the text.
  `mdsync.js` maps the offsets between the blocks of the text.

The board home is `~/.config/herdr-app/board` on this Mac and `~/.herdr/board`
on other machines. The engine is the only writer of `tasks.json`,
`boards.json`, `teams.json` and `settings.json` there.

## Updates

One open copy of the board polls the engines. Once a minute, it compares each
machine's `engine/VERSION` with the bundled engine. If they differ, it copies
the engine and the guide, writes the launchd plist and restarts the service.
To change the engine, edit `engine/engine.mjs` here. Every machine gets the
new engine the next time a board view runs.

## Ids

Inside an engine, ids are local to its machine (`t7`, `sp…`). In the app,
another machine's terminals and spaces are `<machine>/t7`. `qual()` and
`local()` in `state.js` are the only places that map between the two.

## Limits

- Agent status comes from herdr-core. Older cores report a word, and newer ones
  report `{ app, state }`. The engine reads both.
- A user launchd agent starts after a login. A machine that restarts runs its
  engine only after someone logs in, or with automatic login.
- In Tabs mode, a run's tab has no name. Herdr calls it by its number.
- Each new worktree is a new folder for Claude, so Claude asks whether to
  trust it. The card shows that the agent waits. Peek to answer.
- A Claude Code run that waits for a usage limit shows "usage limit" and the
  reset time. The engine reads the core's status message, and the screen once
  per status change (and once a minute while it waits), for Claude Code's
  limit sentences. Other agents are not classified. A run shown in a Herdr
  pane still gets Herdr's own blocked toast and sound: that is the app's, not
  the board's.
