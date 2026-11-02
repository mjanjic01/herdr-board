// A board's environment: the setup command each new task worktree runs before
// its agent starts, notes about this machine that go into every brief, and the
// person's standing answers ("Decisions the person already made" in briefs).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, TextareaState, Textarea } from "gpui-base";
import { theme, props, closeOverlay, spaces } from "herdr";
import { boardOfSpace, boardSettings, setBoardSettings, stateOf } from "./state.js";
import { button, label, field, titleRow, closeButton } from "./ui.js";

export class EnvView extends View {
  init(_props, cx) {
    const space = this.space();
    const b = boardOfSpace(space);
    const defaults = stateOf(b?.machine ?? space?.machine ?? null)?.boardDefaults ?? {};
    const s = { ...defaults, ...boardSettings(space) };
    this.setup = InputState.new({ value: s.setup ?? "", placeholder: "e.g. npm ci (runs in each new task worktree)" });
    this.notes = TextareaState.new({ value: s.envNotes ?? "", placeholder: "What every agent on this board should know about this machine" });
    this.answers = TextareaState.new({ value: s.standing ?? "", placeholder: "e.g. Review deployment box: always tick it." });
    this.focused = null;
    for (const [k, st] of Object.entries({ setup: this.setup, notes: this.notes, answers: this.answers })) {
      st.on("focus", (_e, cx) => { this.focused = k; cx.notify(); });
      st.on("blur", (_e, cx) => { if (this.focused === k) this.focused = null; cx.notify(); });
    }
    this.error = "";
    this.busy = false;
  }

  space() {
    const id = props()?.space;
    return spaces().find((s) => s.id === id) ?? null;
  }
  ctx() { const b = boardOfSpace(this.space()); return b ? { machine: b.machine, board: b.id } : null; }

  close() {
    for (const st of [this.setup, this.notes, this.answers]) st.release?.();
    closeOverlay(props().overlay);
  }

  save(cx) {
    this.busy = true; this.error = "";
    cx.notify();
    const patch = { setup: this.setup.value().trim(), envNotes: this.notes.value().trim(), standing: this.answers.value().trim() };
    cx.spawn(async (cx) => {
      try { await setBoardSettings(this.space(), patch); this.busy = false; this.close(); }
      catch (e) { this.busy = false; this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  render(cx) {
    const tm = theme();
    const b = boardOfSpace(this.space());
    const area = (st, key, h) => div().h(h).p(8).rounded(7).border_1().border_color(this.focused === key ? tm.accent : tm.input).bg(tm.background)
      .child(Textarea.new(st).size_full().text_size(12.5).text_color(tm.foreground));
    return v_flex().id("env-root").size_full().p(20).bg(tm.popover).text_color(tm.foreground)
      .child(titleRow("Board setup and notes", closeButton("env-close", () => this.close())))
      .child(div().pt(4).text_size(11.5).text_color(tm.dim).truncate().child(b ? `${b.machine ?? "This Mac"} · ${b.folder}` : "The board's engine has not answered yet."))
      .child(v_flex().id("env-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(label("Setup command: runs in every new task worktree before its agent starts (output in setup.log in the task folder)"))
        .child(field(this.setup, this.focused === "setup"))
        .child(label("Environment notes: go into every brief on this board"))
        .child(area(this.notes, "notes", 150))
        .child(label("Standing answers: decisions agents follow without asking you"))
        .child(area(this.answers, "answers", 150)))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(12).text_color(tm.blocked).child(this.error)))
      .child(h_flex().pt(12).gap(8).justify_end()
        .child(button("env-cancel", "Cancel", () => this.close()))
        .child(button("env-save", this.busy ? "Saving…" : "Save", (_e, cx) => this.save(cx), { primary: true, disabled: this.busy || !b })));
  }
}
