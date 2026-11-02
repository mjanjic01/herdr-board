// The Teams window: each machine's team library. Pick a machine and a team;
// make, rename, duplicate or delete teams, copy a team to another machine, copy
// a member in from another team, and edit the team's members: which program
// and model each runs, their brief, and who they may hand a task to.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { theme, props, closeOverlay, machines } from "herdr";
import { team, member, uid, programs, knownNow, PALETTE, capacityOf, teamsOf, teamById, served, setTeamMembers, teamOp, copyTeam, stateOf, SECRET_NAME, secretAccount, secretStatus, secretSet } from "./state.js";
import { button, tiny, label, field, memberChip, programIcon, chips, titleRow, closeButton, colorOf, dot } from "./ui.js";
import { MarkdownEditor } from "./mdeditor.js";

// "--a 'b c'" <-> ["--a", "b c"]: plain words, with single or double quotes for spaces.
const splitArgs = (text) => [...(text ?? "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((x) => x[1] ?? x[2] ?? x[3]);
const joinArgs = (args) => (args ?? []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");

export class TeamsView extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.focusedField = null;
    this.states = null;
    this.dirty = false;
    this.error = "";
    this.info = "";
    this.pick = null; // "copy-in" | "copy-to" | null
    this.machine = props()?.machine ?? null;
    this.teamId = props()?.team ?? teamsOf(this.machine)[0]?.id ?? null;
    this.nameState = InputState.new({ value: teamById(this.machine, this.teamId)?.name ?? "", placeholder: "Team name" });
    this.nameState.on("focus", (_e, cx) => { this.focusedField = "teamName"; cx.notify(); });
    this.nameState.on("blur", (_e, cx) => { if (this.focusedField === "teamName") this.focusedField = null; cx.notify(); });
    this.nameState.on("submit", (_e, cx) => this.op(cx, { op: "team-rename", team: this.teamId, name: this.nameState.value() }));
    const first = member(props()?.id, this.ctx()) ?? team(this.ctx())[0] ?? null;
    this.select(first, cx);
    this.handle.focus();
    cx.spawn(async (cx) => { await programs(); cx.notify(); });
  }

  ctx() { return { machine: this.machine, team: this.teamId }; }

  // Shows a team (on a machine): its first member in the form.
  showTeam(machine, teamId, cx) {
    if (this.dirty) { this.error = "Save or discard this member first."; cx.notify(); return; }
    this.machine = machine;
    this.teamId = teamId;
    this.pick = null;
    this.info = "";
    this.nameState.set_value(teamById(machine, teamId)?.name ?? "");
    this.select(team(this.ctx())[0] ?? null, cx);
  }

  // A library request; its answer's warnings show under the bar.
  op(cx, body, after) {
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const ans = await teamOp(this.machine, body);
        this.info = (ans.warnings ?? []).join(" ");
        after?.(ans);
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  // Shows one member in the form; its text states are made here, never in render.
  select(m, cx) {
    this.releaseStates();
    this.current = m ? { ...m, handoffs: [...(m.handoffs ?? [])], secrets: [...(m.secrets ?? [])] } : null;
    this.secretSet = {};   // NAME -> true | false | undefined (still asking)
    this.secretEdit = null; // the NAME whose value is being replaced
    this.secretError = "";
    this.dirty = false;
    this.error = "";
    if (!m) { cx?.notify?.(); return; }
    const bind = (state, key) => {
      state.on("change", (_e, cx) => { this.current[key] = state.value(); this.dirty = true; cx.notify(); });
      state.on("focus", (_e, cx) => { this.focusedField = key; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focusedField === key) this.focusedField = null; cx.notify(); });
      return state;
    };
    this.states = {
      name: bind(InputState.new({ value: m.name, placeholder: "Name" }), "name"),
      role: bind(InputState.new({ value: m.role, placeholder: "Role, e.g. Reviewer" }), "role"),
      model: bind(InputState.new({ value: m.model ?? "", placeholder: "the program's default" }), "model"),
      args: bind(InputState.new({ value: joinArgs(m.args), placeholder: "e.g. --permission-mode acceptEdits" }), "argsText"),
      capacity: bind(InputState.new({ value: String(capacityOf(m)), placeholder: "1" }), "capacityText"),
      secretName: InputState.new({ placeholder: "NAME, e.g. GITHUB_TOKEN" }),
      secretValue: InputState.new({ placeholder: "value (one line)" }),
      brief: new MarkdownEditor({
        id: `brief-${m.id}`, value: m.brief ?? "", height: 260, placeholder: "Write the brief…",
        onChange: (md) => { if (md !== (this.current.brief ?? "")) { this.current.brief = md; this.dirty = true; } },
        onFocus: (cx) => { this.focusedField = "brief"; cx.notify(); },
        onBlur: (cx) => { if (this.focusedField === "brief") this.focusedField = null; cx.notify(); },
      }),
    };
    this.states.secretValue.set_masked(true);
    for (const k of ["secretName", "secretValue"]) {
      this.states[k].on("focus", (_e, cx) => { this.focusedField = k; cx.notify(); });
      this.states[k].on("blur", (_e, cx) => { if (this.focusedField === k) this.focusedField = null; cx.notify(); });
    }
    this.states.secretValue.on("submit", (_e, cx) => this.storeSecret(cx));
    this.refreshSecrets(cx);
    cx?.notify?.();
  }

  // Which of the member's secrets have a value on the team's machine.
  refreshSecrets(cx) {
    const c = this.current;
    if (!c?.secrets?.length || !cx?.spawn) return;
    const names = [...c.secrets];
    cx.spawn(async (cx) => {
      try {
        const set = await secretStatus(this.machine, names.map((n) => secretAccount(this.teamId, c.id, n)));
        if (this.current?.id !== c.id) return;
        for (const n of names) this.secretSet[n] = Boolean(set[secretAccount(this.teamId, c.id, n)]);
      } catch (e) { this.secretError = String(e?.message ?? e); }
      cx.notify();
    });
  }

  // Stores the typed value: for a new name (added to the member and saved), or
  // a replacement for secretEdit. The field is cleared at once.
  storeSecret(cx) {
    const c = this.current;
    if (!c || this.secretBusy) return;
    if (!team(this.ctx()).some((m) => m.id === c.id)) { this.secretError = "Save the member first."; cx.notify(); return; }
    const name = (this.secretEdit ?? this.states.secretName.value()).trim().toUpperCase();
    const value = this.states.secretValue.value();
    if (!SECRET_NAME.test(name)) { this.secretError = "A name is letters, digits and _, starting with a letter: GITHUB_TOKEN."; cx.notify(); return; }
    if (!this.secretEdit && c.secrets.includes(name)) { this.secretError = `${name} is already there: use Replace.`; cx.notify(); return; }
    this.states.secretValue.set_value("");
    this.secretBusy = true; this.secretError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await secretSet(this.machine, secretAccount(this.teamId, c.id, name), value);
        this.secretSet[name] = true;
        if (!c.secrets.includes(name)) { this.current.secrets = [...c.secrets, name]; this.dirty = true; this.save(cx); }
        this.states?.secretName.set_value("");
        this.secretEdit = null;
      } catch (e) { this.secretError = String(e?.message ?? e); }
      this.secretBusy = false;
      cx.notify();
    });
  }

  // The secrets part of the form: names with whether a value is set; values never show.
  secretsForm(tm) {
    const c = this.current;
    const rows = c.secrets.map((n) => h_flex().id(`sec-${n}`).items_center().gap(8).py(4)
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family("JetBrains Mono").text_color(tm.foreground).child(`$${n}`))
      .child(div().text_size(11).text_color(this.secretSet[n] === undefined ? tm.dim : this.secretSet[n] ? tm.working : tm.blocked)
        .child(this.secretSet[n] === undefined ? "…" : this.secretSet[n] ? "•••• set" : "not set"))
      .child(tiny(`sec-edit-${n}`, this.secretSet[n] ? "Replace" : "Set", (_e, cx) => { this.secretEdit = n; this.secretError = ""; this.states.secretValue.set_value(""); this.states.secretValue.focus(); cx.notify(); }))
      .child(tiny(`sec-rm-${n}`, "Remove", (_e, cx) => { this.current.secrets = c.secrets.filter((x) => x !== n); this.dirty = true; if (this.secretEdit === n) this.secretEdit = null; cx.notify(); }, { danger: true })));
    return v_flex()
      .children(rows)
      .child(h_flex().gap(8).pt(4).items_center()
        .child(this.secretEdit
          ? div().w(200).text_size(12).text_color(tm.muted).child(`New value for $${this.secretEdit}`)
          : div().w(200).child(field(this.states.secretName, this.focusedField === "secretName")))
        .child(div().flex_1().child(field(this.states.secretValue, this.focusedField === "secretValue")))
        .child(tiny("sec-store", this.secretBusy ? "Saving…" : this.secretEdit ? "Save value" : "Add", (_e, cx) => this.storeSecret(cx), { disabled: this.secretBusy }))
        .when(Boolean(this.secretEdit), (el) => el.child(tiny("sec-cancel", "Cancel", (_e, cx) => { this.secretEdit = null; this.states.secretValue.set_value(""); cx.notify(); }))))
      .when(Boolean(this.secretError), (el) => el.child(div().pt(4).text_size(11).text_color(tm.blocked).child(this.secretError)))
      .child(div().pt(5).text_size(10.5).text_color(tm.dim).child("Values stay in this machine's Keychain and never show again. The agent gets them as environment variables, and its brief lists only the names. Removing a name deletes its value when you save."));
  }

  releaseStates() {
    for (const s of Object.values(this.states ?? {})) s.release?.();
    this.states = null;
  }

  // Unsaved changes are saved on close. If they cannot be saved, the error
  // shows, and a second close with nothing changed leaves without saving.
  close(cx) {
    const now = JSON.stringify(this.current);
    if (this.dirty && this.leaving !== now) {
      this.save(cx);
      if (this.dirty) { this.leaving = now; this.error += " Close again to leave without saving."; cx.notify(); return; }
    }
    this.releaseStates();
    closeOverlay(props().overlay);
  }

  save(cx) {
    const c = this.current;
    if (!c) return;
    if (!c.name.trim()) { this.error = "Give them a name."; cx.notify(); return; }
    if (team(this.ctx()).some((m) => m.id !== c.id && m.name.trim().toLowerCase() === c.name.trim().toLowerCase())) { this.error = "Another member has that name; hand-offs go by name."; cx.notify(); return; }
    const clean = { ...c, name: c.name.trim(), role: c.role.trim() || "Agent", model: (c.model ?? "").trim(), args: splitArgs(c.argsText ?? joinArgs(c.args)), argsText: undefined, capacity: capacityOf({ capacity: c.capacityText ?? c.capacity }), capacityText: undefined, handoffs: c.handoffs.filter((id) => id !== c.id && team(this.ctx()).some((m) => m.id === id)) };
    const list = team(this.ctx());
    this.op(cx, { op: "team-set-members", team: this.teamId, members: list.some((m) => m.id === c.id) ? list.map((m) => (m.id === c.id ? clean : m)) : [...list, clean] });
    this.current = { ...clean };
    this.dirty = false;
    this.error = "";
    cx.notify();
  }

  add(cx) {
    const used = new Set(team(this.ctx()).map((m) => m.color));
    const m = { id: uid("m"), name: "", role: "", program: knownNow().find((p) => p.installed)?.key ?? "claude", model: "", color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[team(this.ctx()).length % PALETTE.length], brief: "", handoffs: [] };
    this.select(m, cx);
    this.dirty = true;
    this.states.name.focus();
  }

  remove(cx) {
    const c = this.current;
    if (!c) return;
    this.op(cx, { op: "team-set-members", team: this.teamId, members: team(this.ctx()).filter((m) => m.id !== c.id).map((m) => ({ ...m, handoffs: (m.handoffs ?? []).filter((id) => id !== c.id) })) });
    this.select(team(this.ctx()).find((m) => m.id !== c.id) ?? null, cx);
  }

  // The bar above the editor: machines, their teams, and what to do with the team.
  library(cx) {
    const tm = theme();
    const machinesNow = served();
    const teams = teamsOf(this.machine);
    const cur = teamById(this.machine, this.teamId);
    const others = machinesNow.filter((m) => m !== this.machine && stateOf(m));
    const otherMembers = teams.filter((t) => t.id !== this.teamId).flatMap((t) => t.members.map((m) => ({ id: `${t.id}:${m.id}`, label: `${m.name} · ${t.name}`, color: m.color })));
    const usedBy = (stateOf(this.machine)?.boards ?? []).filter((b) => b.team === this.teamId).length;
    return v_flex().gap(8).pt(6).pb(10).border_b(1).border_color(tm.border)
      .child(h_flex().items_center().gap(8)
        .child(div().w(70).text_size(11).font_semibold().text_color(tm.dim).child("MACHINE"))
        .child(chips("mc", machinesNow.map((m) => ({ id: m ?? "", label: m ?? "This Mac" })), this.machine ?? "", (id, cx) => this.showTeam(id || null, teamsOf(id || null)[0]?.id ?? null, cx))))
      .child(h_flex().items_center().gap(8)
        .child(div().w(70).text_size(11).font_semibold().text_color(tm.dim).child("TEAM"))
        .child(teams.length ? chips("tc", teams.map((t) => ({ id: t.id, label: `${t.name} (${t.members.length})` })), this.teamId ?? "", (id, cx) => this.showTeam(this.machine, id, cx)) : div().text_size(12).text_color(tm.dim).child(stateOf(this.machine) ? "No teams yet." : "The board engine there has not answered."))
        .child(tiny("team-new", "+ New team", (_e, cx) => this.op(cx, { op: "team-create", name: "New team" }, (a) => { this.teamId = a.team; this.nameState.set_value(a.name); this.select(null, cx); }))))
      .when(Boolean(cur), (el) => el.child(h_flex().items_center().gap(8)
        .child(div().w(70))
        .child(div().w(200).child(field(this.nameState, this.focusedField === "teamName", { h: 28 })))
        .child(tiny("team-rename", "Rename", (_e, cx) => this.op(cx, { op: "team-rename", team: this.teamId, name: this.nameState.value() })))
        .child(tiny("team-dup", "Duplicate", (_e, cx) => this.op(cx, { op: "team-duplicate", team: this.teamId }, (a) => { this.teamId = a.team; this.nameState.set_value(a.name); })))
        .child(tiny("team-copy-in", "Copy a member in…", (_e, cx) => { this.pick = this.pick === "copy-in" ? null : "copy-in"; cx.notify(); }, { disabled: !otherMembers.length }))
        .child(tiny("team-copy-to", "Copy to machine…", (_e, cx) => { this.pick = this.pick === "copy-to" ? null : "copy-to"; cx.notify(); }, { disabled: !others.length }))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(tm.dim).child(usedBy ? `${usedBy} board${usedBy === 1 ? "" : "s"} use it` : "no board uses it"))
        .child(tiny("team-delete", "Delete", (_e, cx) => this.op(cx, { op: "team-delete", team: this.teamId }, () => { this.teamId = teamsOf(this.machine).find((t) => t.id !== this.teamId)?.id ?? null; this.select(null, cx); }), { danger: true, disabled: usedBy > 0 }))))
      .when(this.pick === "copy-in", (el) => el.child(h_flex().gap(8).items_center().child(div().w(70).text_size(11).text_color(tm.dim).child("copy in"))
        .child(chips("ci", otherMembers, "", (id, cx) => { const [team, mem] = id.split(":"); this.pick = null; this.op(cx, { op: "team-copy-member", team: this.teamId, from: { team, member: mem } }); }))))
      .when(this.pick === "copy-to", (el) => el.child(h_flex().gap(8).items_center().child(div().w(70).text_size(11).text_color(tm.dim).child("copy to"))
        .child(chips("ct", others.map((m) => ({ id: m ?? "", label: m ?? "This Mac" })), "", (id, cx) => {
          this.pick = null; this.error = ""; cx.notify();
          cx.spawn(async (cx) => {
            try { const a = await copyTeam(this.machine, this.teamId, id || null); this.info = `Copied to ${id || "this Mac"} as ${a.name}. ${(a.warnings ?? []).join(" ")}`; }
            catch (e) { this.error = String(e?.message ?? e); }
            cx.notify();
          });
        }))))
      .when(Boolean(this.info), (el) => el.child(div().text_size(11.5).text_color(tm.muted).child(this.info)));
  }

  render(cx) {
    const tm = theme();
    const list = team(this.ctx());
    const c = this.current;
    const known = knownNow();
    const progItems = [
      ...known.filter((p) => p.installed || p.key === c?.program).map((p) => ({ id: p.key, label: p.name, icon: programIcon(p, 12) })),
      ...(c && !known.some((p) => p.key === c.program) ? [{ id: c.program, label: c.program }] : []),
    ];
    const row = (m) => {
      const on = c?.id === m.id;
      const prog = known.find((p) => p.key === m.program);
      return h_flex().id(`tm-${m.id}`).h(40).px(10).gap(8).items_center().rounded(7).cursor_pointer().flex_none()
        .when(on, (el) => el.bg(tm.selected)).when(!on, (el) => el.hover((s) => s.bg(tm.hover)))
        .on_click((_e, cx) => this.select(m, cx))
        .child(dot(colorOf(tm, m.color), 9))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12.5).font_medium().text_color(tm.foreground).child(m.name))
          .child(div().truncate().text_size(10.5).text_color(tm.dim).child(`${m.role}${prog ? ` · ${prog.name}` : ` · ${m.program}`}${m.model ? ` · ${m.model}` : ""}`)))
        .when(Boolean(prog), (el) => el.child(programIcon(prog, 13)));
    };
    const left = v_flex().w(240).h_full().flex_none().gap(4).pr(14).border_r(1).border_color(tm.border)
      .child(h_flex().items_center().pb(6).child(div().flex_1().text_size(11).font_semibold().text_color(tm.dim).child("TEAM")).child(tiny("add", "+ Add", (_e, cx) => this.add(cx))))
      .child(v_flex().id("team-list").flex_1().min_h(0).gap(2).overflow_y_scrollbar().children(list.map(row))
        .when(c && !list.some((m) => m.id === c.id), (el) => el.child(row(c))))
      .child(div().pt(8).text_size(10.5).text_color(tm.dim).child("Hand-offs go by name: an agent writes {\"action\":\"handoff\",\"to\":\"Bo\"}."))
      ;
    const form = !c
      ? div().flex_1().p(20).text_size(12.5).text_color(tm.dim).child("Pick a member, or add one.")
      : v_flex().flex_1().h_full().min_w(0).pl(16)
          .child(v_flex().id("team-form").flex_1().min_h(0).overflow_y_scrollbar().pr(4)
            .child(h_flex().gap(10)
              .child(v_flex().flex_1().child(label("Name")).child(field(this.states.name, this.focusedField === "name")))
              .child(v_flex().flex_1().child(label("Role")).child(field(this.states.role, this.focusedField === "role"))))
            .child(label("Program"))
            .child(progItems.length ? chips("pg", progItems, c.program, (id, cx) => { this.current.program = id; this.dirty = true; cx.notify(); }) : div().text_size(12).text_color(tm.dim).child("Looking for installed agents…"))
            .child(label("Model (passed as --model)"))
            .child(field(this.states.model, this.focusedField === "model"))
            .child(label("Extra arguments (added after the model, on every machine)"))
            .child(field(this.states.args, this.focusedField === "argsText"))
            .child(label("Tasks at once (with worktrees, each task has its own checkout)"))
            .child(div().w(90).child(field(this.states.capacity, this.focusedField === "capacityText")))
            .child(label("Secrets"))
            .child(this.secretsForm(tm))
            .child(label("Brief"))
            .child(this.states.brief.render(cx, { focused: this.focusedField === "brief" }))
            .child(div().pt(5).text_size(10.5).text_color(tm.dim).child(!(c.brief ?? "").trim()
              ? "What this member does, how, and when to hand off. Markdown; the preview shows it rendered."
              : "cmd-b, cmd-i, cmd-e, cmd-k format the selection. The agent reads it at the top of brief.md, so use ## or deeper."))
            .child(label("May hand off to"))
            .child(list.filter((m) => m.id !== c.id).length
              ? chips("ho", list.filter((m) => m.id !== c.id).map((m) => ({ id: m.id, label: `${m.name} · ${m.role}`, color: m.color })), c.handoffs, (id, cx) => {
                  const h = this.current.handoffs;
                  this.current.handoffs = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
                  this.dirty = true; cx.notify();
                }, { multi: true })
              : div().text_size(12).text_color(tm.dim).child("Nobody else on the team yet."))
            .child(label("Color"))
            .child(h_flex().gap(6).children(PALETTE.map((name) => div().id(`cl-${name}`).w(18).h(18).rounded_full().bg(colorOf(tm, name)).cursor_pointer()
              .border_2().border_color(c.color === name ? tm.foreground : tm.popover)
              .on_click((_e, cx) => { this.current.color = name; this.dirty = true; cx.notify(); })))))
          .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(12).text_color(tm.blocked).child(this.error)))
          .child(h_flex().pt(12).gap(8).items_center()
            .child(button("remove", "Remove", (_e, cx) => this.remove(cx), { danger: true }))
            .child(div().flex_1())
            .when(this.dirty, (el) => el.child(div().text_size(11).text_color(tm.dim).child("unsaved changes")))
            .child(button("save", "Save", (_e, cx) => this.save(cx), { primary: true, disabled: !this.dirty })));
    return v_flex().id("team-view").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(cx); cx.stop_propagation(); } })
      .size_full().p(18).bg(tm.popover).text_color(tm.foreground).text_size(12.5)
      .child(titleRow("Teams", h_flex().items_center().gap(8).child(closeButton("close", (_e, cx) => this.close(cx))).child(button("done", "Done", (_e, cx) => this.close(cx)))))
      .child(this.library(cx))
      .child(h_flex().flex_1().min_h(0).pt(10).child(left).child(form));
  }
}
