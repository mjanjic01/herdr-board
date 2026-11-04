# The Herdr board on this machine

Herdr is a desktop app for terminals and coding agents. Its board is a kanban
board with the columns Backlog, To do, In progress, Review and Done. A team of
agents works on the tasks and hands each task from one member to the next.

This machine runs its own board engine: a small program that the launchd
service `dev.herdr.board` keeps running. The engine starts the team members,
reads the results they write, and hands tasks on. It works while the Herdr app
on the Mac is closed. The Herdr app only shows the boards and sends changes.

## Boards and teams

- A board belongs to one checkout: the top folder of a git repository, or of
  one of its worktrees, or a plain folder. Two worktrees of one repository
  have two boards.
- The worktrees that the board makes for its own tasks (branches that start
  with `board/`, under `~/.herdr/worktrees/`) are never boards.
- This machine keeps a library of named teams. Each board uses one team.
  Several boards can use the same team, and each board has its own capacity.
- Member names are matched within the team of the task's board.

## The folder

```
~/.herdr/board/
  board.json            a summary of the boards, teams and tasks (read only)
  state.json            everything, for the Herdr app (read only)
  inbox/                requests to the engine: write here
    <name>.json           one request (see below)
    .claimed/             requests the engine is processing now (do not touch)
    done/<name>.json      the answer to a request it carried out
    failed/<name>.json    the answer to a request it refused, with the reason
  tasks/<task id>/      one folder per task
    brief.md              what the current team member was told
    result.<run>.json     how a member finished its part (written by the member)
    plan.md, changes.md, review.md   notes the members leave for each other
    files/                files attached to the task
  tasks.json boards.json teams.json settings.json   the engine's own files
  engine/               the engine program (the Herdr app updates it)
  engine.log            what the engine did
```

Only write to `inbox/`. The engine writes everything else.

## Read the board

Read `board.json`. It holds:

- `boards`: one entry per board. Each has `folder`, `team`, `pick_up`,
  `worktrees`, and `open`. `open` is true when a Herdr space shows the board.
  A space shows the board of the folder that its first terminal is in when
  the space first shows a board. It keeps that board while it is open, also
  if that terminal moves into a task's worktree later.
  `members` lists the team: name, role, program, model, `tasks_at_once` and
  `hands_off_to`.
- `teams`: the team library, with the member names of each team.
- `columns`: the column ids `backlog`, `todo`, `doing`, `review`, `done`.
- `autopilot`: if true, hand-offs and requests for `doing` start agents.
- `tasks`: one entry per task. Each has `id`, `title`, `board` (its folder),
  `team`, `column` and `assignee`. `working` is the agent status while one
  runs: `working`, `blocked`, `done`, `idle`, `starting` or `limited`.
  `limited` means that Claude Code waits for a usage limit to reset and
  continues by itself. `limit` is `{ until, auto }` or null: `until` is the
  reset time as Claude prints it ("10pm") or null, and `auto` is false when
  Claude stopped at the limit. `attention` is a note for the person, or null. It also has
  `worktree`, `task_folder`, `recent` (the last history lines) and `updated`.

The engine updates `board.json` within a few seconds of a change.

## Write a request

A request is one JSON object in one file. To write one:

1. Write the JSON to a file whose name starts with a dot, in `inbox/`.
2. Rename that file to a name that ends in `.json`. Use a unique name, for
   example with a timestamp.

The engine skips files whose names start with a dot, so it never reads a
half-written file. It applies a request within about a second.

```sh
d=~/.herdr/board/inbox
printf '%s' '{"title": "Fix the login redirect", "folder": "/Users/me/code/app"}' > "$d/.req.tmp"
mv "$d/.req.tmp" "$d/login-$(date +%s).json"
```

Every request can have `"from"`: a short label for who sent it, for example
`"from": "a Claude session"`. The engine writes it in the task history.

### Create a task

The default operation. Fields:

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | A short title. |
| `folder` | yes | The absolute path, on this machine, of the repository or worktree. The task goes on the board of the checkout that holds this folder. |
| `description` | no | Markdown: what to do, where, and how to know it is done. |
| `assignee` | no | A member name from that board's team. |
| `column` | no | `backlog`, `todo` (default) or `doing`. Only `doing` starts anyone. It needs an assignee, Autopilot on, and an open Herdr space that shows the board. Otherwise the task goes to `todo` and the answer says why. |
| `dependsOn` | no | Tasks this one waits for: a list of task ids, or exact titles on the same board. It starts (by hand, by a hand-off or by Pick up) only when every one is in `review` or `done`. Ids from another board, and loops, are refused. |

```json
{"title": "Write the README", "description": "Install, usage, one example.", "folder": "/Users/me/code/cli", "assignee": "Ana", "from": "a Claude session"}
```

A new folder gets a new board, with the first team in the library.

### Move, assign, add a note

```json
{"op": "move", "id": "k1a2b3c4d5e6", "column": "review"}
{"op": "assign", "id": "k1a2b3c4d5e6", "assignee": "Bo"}
{"op": "note", "id": "k1a2b3c4d5e6", "text": "The API key is in 1Password."}
```

A move to `doing` starts the assignee under the same rules as a create. A task
whose dependencies are not in `review` or `done` yet waits instead: the answer
says what it waits for, and it starts by itself once they are. Change its
dependencies with `{"op": "update", "id": "…", "patch": {"dependsOn": ["k…"]}}`.
In `board.json`, each task lists `depends_on` and `waits_for`.

## Answers

The engine moves each request to `.claimed/`, carries it out, and writes the
answer to `done/<name>.json` or `failed/<name>.json`:

```json
{ "ok": true, "id": "k1a2b3c4d5e6", "board": "/Users/me/code/app", "team": "Default", "column": "todo", "started": false, "request": { ... }, "at": "..." }
```

- `warning`: something the person must know, for example that no Herdr space
  shows the board yet.
- `repeated: true`: the same request file was carried out before. Nothing
  changed.
- `error` (in `failed/`): why the engine refused the request.

Answers older than a day are deleted.

## Rules

- If you are a member of the board team (your first message says that the
  Herdr board coordinates you), do not write requests unless the person asks.
- Only `doing` starts an agent. If the person did not ask to start the work
  now, use `todo`.
- Use absolute paths for `folder`.
- Do not edit the engine's files, the answers or the task folders.

## Secrets

A team member can have secrets: access tokens, passwords and the like. The
member lists only their names (`secrets: ["GITHUB_TOKEN"]`). The values stay in
this machine's macOS Keychain, under the service `herdr-board`, and never go
into `board.json`, the state files, a brief or the inbox. When the engine starts
that member, the agent gets the values as environment variables, and its brief
names them. You set the values in the Teams window. Requests in the inbox
cannot set, read or list secret values.

## Heavy jobs and a busy machine

Browser, e2e and Playwright suites are heavy. Several at once can make a
machine so slow that it drops off the network. The board limits them in three
ways:

- **Agents run at low priority.** Every agent, and everything it starts, runs
  under `nice -n 10` (the machine setting `niceness`, 0 turns it off). The
  machine stays responsive to ssh and the network.
- **Browser slots.** Run a suite through `"$BOARD_HEAVY"`, the board's
  `board-heavy` script (in `bin/` here): `"$BOARD_HEAVY" npm run test:e2e --
  --workers=$BOARD_WORKERS`. It waits until one of the machine's slots is free
  (the machine setting `heavySlots`, default 1), runs the suite at low
  priority, and frees the slot when it ends. While it waits, the task's card
  says "Waits for a browser slot (held by …)". `$BOARD_WORKERS` is the board's
  "Browsers per test run" (the `workers` setting, default 4): how many browsers
  one run may open at once, not how many agents work at once (that is each
  member's "Tasks at once"). The same number is in `PLAYWRIGHT_WORKERS`,
  `PW_WORKERS` and `E2E_WORKERS`.
- **The load gate.** While the kernel reports memory pressure (warning or
  critical) or the 1-minute load is over 1.5 × the cores, the engine starts
  nothing new on this machine: no hand-offs, pick-ups or waiting starts.
  Running work goes on, and a Start by the person still works. Cards say
  "Waits: <machine> is busy (memory)", and the board's header says "busy". It
  opens after two calm checks in a row. The machine settings `gatePressure`
  (2), `gateLoad` (1.5) and `gateSwap` (0: off, because macOS keeps swap once
  it grew) set the limits; 0 turns a rule off.

The person sees and sets all this in the board's **Machine…** window: the last
hour of load per core, memory pressure and swap (with the gate's limits and the
times it was closed), the gate and the browser slots right now, and the machine
settings above plus the run limit. The engine writes those numbers to
`machine.json` here about every 10 seconds, apart from `state.json`.

## Browsers for agents (agent-browser)

Members can drive Chrome with `agent-browser` from the shell instead of the
chrome-devtools MCP tools: say so in their brief. The engine gives every run
its own browser:

- `AGENT_BROWSER_SESSION` is `<task>-<run>`, and `AGENT_BROWSER_NAMESPACE` is
  the run id. A `close --all` in one run cannot reach another run's browsers.
- `AGENT_BROWSER_IDLE_TIMEOUT_MS` is 600000. A daemon (the agent-browser
  background process) with no command for 10 minutes ends by itself.
- When a run writes its result or ends, the engine stops that run's daemons
  and their Chrome. It finds them through the pid files in
  `~/.agent-browser/namespaces/<run>/run/`. It never stops other runs'
  browsers, the person's Chrome or the board's Chrome profiles. The log line
  is "closed agent-browser <pid> of run <run>".

Inside Codex's `workspace-write` sandbox, `agent-browser` from the shell does
not work: Chrome cannot start there. Codex members can use `agent-browser mcp`
as an MCP server, because MCP servers run outside the sandbox. Codex does not
pass the agent's environment to MCP servers, so the server's configuration
must forward the session: `env_vars = ["AGENT_BROWSER_SESSION",
"AGENT_BROWSER_NAMESPACE", "AGENT_BROWSER_IDLE_TIMEOUT_MS"]`.
