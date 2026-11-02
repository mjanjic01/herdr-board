// A text block the person can copy and view as source: the rendered markdown,
// or the same text in a read-only editor where a selection stays visible.
// Each block (the note, the description) has its own Source toggle.
import { div } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { theme, settings } from "herdr";
import { tiny } from "./ui.js";
import { noteOf } from "./note.js";

export class TextBlocks {
  constructor() {
    this.source = { note: false, desc: false };
    this.editors = {};
    this.copied = null; // the Copy button that says "Copied" now
  }

  copyButton(id, text) {
    return tiny(id, this.copied === id ? "Copied" : "Copy", (_e, cx) => {
      cx.write_to_clipboard(text);
      this.copied = id;
      cx.notify();
      cx.timer.after(1500, (cx) => { if (this.copied === id) { this.copied = null; cx.notify(); } });
    });
  }

  // Does Source show this text now? The button label and block() both ask this,
  // so a changed text shows rendered with a "Source" button, and one click shows it.
  showing(key, text) {
    return this.source[key] && Boolean(this.editors[key]) && this.editors[key].value() === text;
  }

  sourceButton(key, text) {
    const on = this.showing(key, text);
    return tiny(`source-${key}`, on ? "Rendered" : "Source", (_e, cx) => {
      if (on) this.source[key] = false;
      else { this.source[key] = true; this.open(key, text); }
      cx.notify();
    });
  }

  // open, refresh and hide run from handlers or after an await, never from render:
  // EditorState.new and set_value need a live host call.
  open(key, text) {
    const s = this.editors[key];
    if (s) { if (s.value() !== text) s.set_value(text); return; }
    const t = theme();
    this.editors[key] = EditorState.new({ language: "markdown", value: text, readonly: true, soft_wrap: true, line_numbers: false, folding: false,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  // Only editors that exist: a block nobody opened gets no editor.
  refresh(texts) {
    for (const [key, text] of Object.entries(texts)) {
      const s = this.editors[key];
      if (s && s.value() !== text) s.set_value(text);
    }
  }

  hide(key) {
    this.source[key] = false;
  }

  // The editor has no auto-grow: estimate rows at 85 columns (the 700 px dialog,
  // 12 px mono), 18 px each. A longer text scrolls inside.
  height(text) {
    const rows = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 85)), 0);
    return Math.min(320, Math.max(44, rows * 18 + 16));
  }

  block(key, id, text) {
    if (this.showing(key, text)) return Editor.new(this.editors[key]).w_full().h(this.height(text));
    return TextView.markdown(`${key}-${id}`, text).selectable(true);
  }

  // The Description header's buttons, and its text (rendered or Source).
  descTools(t) {
    if (!t.description?.trim()) return null;
    return h_flex().items_center().gap(6).child(this.copyButton("copy-desc", t.description)).child(this.sourceButton("desc", t.description));
  }

  descBox(t) {
    const tm = theme();
    return t.description?.trim()
      ? div().p(10).rounded(7).bg(tm.surface).text_size(12.5).child(this.block("desc", t.id, t.description))
      : div().text_size(12).text_color(tm.dim).child("No description.");
  }

  // The agent's question: who needs you, then the summary rendered.
  noteBox(t) {
    const { head, body } = noteOf(t);
    const tm = theme();
    return v_flex().mt(8).p(10).gap(6).rounded(6).border_1().border_color(tm.blocked).bg(tm.surface)
      .child(h_flex().items_center().gap(6)
        .child(div().flex_1().min_w(0).text_size(11.5).font_semibold().text_color(tm.blocked).child(head ?? "Needs you"))
        .child(this.copyButton("copy-note", body))
        .child(this.sourceButton("note", body)))
      .child(div().text_size(12.5).text_color(tm.foreground).child(this.block("note", t.id, body)));
  }

  release() {
    for (const s of Object.values(this.editors)) s.release();
    this.editors = {};
  }
}
