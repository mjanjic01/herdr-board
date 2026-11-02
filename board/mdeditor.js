// A live markdown editor: the source on the left with a formatting toolbar,
// the rendered text on the right, updated as you type. The stored text is
// exactly what was typed. The two sides scroll together: each is a viewport
// whose offset this class owns, mapped between per-block anchors (mdsync.js).
import { div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, settings } from "herdr";
import { blocks, references, rows, fitCols, mapOffset, blendEnd, changedEnd, lineOf, rowRange, reveal } from "./mdsync.js";

const FORMATS = { "cmd-b": ["**", "**"], "cmd-i": ["_", "_"], "cmd-e": ["`", "`"], "cmd-k": ["[", "](url)"] };
// A list item: indent, marker, the space after it (or the end of the line), a task box.
const ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+|$)(\[[ xX]\]\s+)?/;
const QUOTE = /^\s*>\s?/;

// The Textarea's inner padding, measured once: 41 columns fit in 331.5 px at
// 7.7 px a character (8.1 < PAD_X <= 15.8), and an empty field is exactly 8 rows.
const PAD_X = 12;
const PAD_Y = 0;
const SRC_PAD = 6;
const PRE_PAD_X = 10;
const PRE_PAD_Y = 8;
const GAP = 8;
const LINE_FALLBACK = 18;
// Trackpad momentum events arrive at most 14 ms apart (measured).
const GESTURE_GAP_MS = 100;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// A short hash so a changed text gets a fresh markdown view id.
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export class MarkdownEditor {
  constructor({ id, value, placeholder, height, onChange, onFocus, onBlur, onPasteOther }) {
    this.id = id;
    this.height = height ?? 240;
    this.onChange = onChange ?? (() => {});
    this.onFocus = onFocus ?? (() => {});
    this.onBlur = onBlur ?? (() => {});
    this.onPasteOther = onPasteOther ?? (() => {});
    this.text = String(value ?? "");
    this.quiet = false; // ignore our own synthetic changes
    this.hasFocus = false;
    this.last = null;
    // The scroll state: the side last scrolled and its offset; what was drawn.
    this.view = { side: "src", y: 0 };
    this.shown = { src: 0, pre: 0 };
    this.max = { src: 0, pre: 0 };
    this.cols = null;
    this.gesture = null;
    this.hover = "src";
    this.sizes = { viewport: 0, bodyW: 0, srcH: 0, srcW: 0, preH: 0, preW: 0, charW: 0, lineH: 0, heights: new Map() };
    const s = TextareaState.new({ value: this.text, placeholder: placeholder ?? "Write markdown…" });
    s.set_soft_wrap(true);
    s.set_auto_grow(8, 4000);
    s.on("change", (_e, cx) => {
      if (this.quiet) return;
      const v = s.value();
      const before = this.text;
      this.last = { before, at: Date.now() };
      this.text = v;
      this.keepVisible(before, v);
      this.onChange(v);
      cx.notify();
    });
    s.on("focus", (_e, cx) => { this.hasFocus = true; this.onFocus(cx); cx.notify(); });
    s.on("blur", (_e, cx) => { this.hasFocus = false; this.onBlur(cx); cx.notify(); });
    // If the textarea handles Enter before the key reaches us, it inserts a
    // newline and submits: the list logic runs from here instead.
    s.on("submit", (e, cx) => {
      if (e.shift || e.secondary) return;
      if (Date.now() - (this.enterAt ?? 0) < 150) { this.takeBack(); return; }
      if (this.enter(cx, true)) this.lateAt = Date.now();
    });
    s.on("paste_other", (_e, cx) => this.onPasteOther(cx));
    this.state = s;
  }

  value() { return this.text; }

  // Shows another text.
  setValue(text) {
    this.text = String(text ?? "");
    this.view = { side: "src", y: 0 };
    this.gesture = null;
    this.quiet = true;
    try { this.state?.set_value(this.text); } finally { this.quiet = false; }
  }

  release() {
    this.state?.release?.();
    this.state = null;
    this.hasFocus = false;
  }

  focus() { this.state?.focus(); }

  // Our own edits: kept in this.text and reported once.
  sync() {
    const v = this.state.value();
    if (v === this.text) return;
    const before = this.text;
    this.text = v;
    this.keepVisible(before, v);
    this.onChange(v);
  }

  // Where the selection is. No control reports its caret, so a token is put
  // in its place and found again; offsets are JS string indices (UTF-16).
  selection() {
    const s = this.state;
    if (!s) return null;
    const before = s.value();
    this.quiet = true;
    try {
      s.replace_with_token({ id: "caret", text: "⁣" });
      const span = s.tokens().find((t) => t.token.id === "caret");
      if (!span) { s.set_value(before); return null; }
      const after = s.content().text;
      const start = span.range.start;
      const end = start + (before.length - (after.length - span.token.text.length));
      s.set_selected_range(span.range);
      s.replace(before.slice(start, end));
      s.set_selected_range({ start, end });
      if (s.value() !== before) s.set_value(before);
      return { start, end, text: before.slice(start, end) };
    } catch {
      try { if (s.value() !== before) s.set_value(before); } catch {}
      return null;
    } finally {
      this.quiet = false;
    }
  }

  // Replaces start..end with text and selects selStart..selEnd (offsets in the new value).
  splice(start, end, text, selStart, selEnd) {
    const s = this.state;
    this.quiet = true;
    try {
      s.set_selected_range({ start, end });
      s.replace(text);
      s.set_selected_range({ start: selStart, end: selEnd ?? selStart });
    } finally { this.quiet = false; }
    this.sync();
  }

  format(open, close, cx) {
    const sel = this.selection();
    if (!sel) return;
    const v = this.state.value();
    const { start, end, text } = sel;
    if (open !== "[" && text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length);
      this.splice(start, end, inner, start, start + inner.length);
    } else if (open !== "[" && v.slice(start - open.length, start) === open && v.slice(end, end + close.length) === close) {
      this.splice(start - open.length, end + close.length, text, start - open.length, start - open.length + text.length);
    } else if (open === "[") {
      const urlAt = start + 1 + text.length + 2;
      this.splice(start, end, `[${text}](url)`, text ? urlAt : start + 1, text ? urlAt + 3 : start + 1);
    } else {
      this.splice(start, end, open + text + close, start + open.length, start + open.length + text.length);
    }
    this.state.focus();
    cx.notify();
  }

  // Heading, list or quote on every line of the selection; again takes it off.
  lines(kind, cx) {
    const sel = this.selection();
    if (!sel) return;
    const v = this.state.value();
    const from = v.lastIndexOf("\n", sel.start - 1) + 1;
    let to = v.indexOf("\n", sel.end);
    if (to < 0) to = v.length;
    const rows = v.slice(from, to).split("\n");
    const has = { heading: /^#{1,6}\s+/, list: /^\s*[-*+]\s+/, quote: QUOTE }[kind];
    const mark = { heading: "## ", list: "- ", quote: "> " }[kind];
    const off = rows.some((r) => r.trim()) && rows.every((r) => has.test(r) || !r.trim());
    const out = rows.map((r) => {
      if (off) return r.replace(has, "");
      if (!r.trim() && rows.length > 1) return r;
      // A heading replaces a list or quote mark, and the other way round.
      return mark + r.replace(/^#{1,6}\s+/, "").replace(QUOTE, "").replace(/^\s*([-*+]|\d+[.)])\s+/, "");
    }).join("\n");
    this.splice(from, to, out, from + out.length);
    this.state.focus();
    cx.notify();
  }

  // Removes a newline the textarea inserted for this Enter, if it did: where it was, else -1.
  takeBack() {
    const s = this.state;
    const last = this.last;
    this.last = null;
    if (!s || !last || Date.now() - last.at > 150) return -1;
    const v = s.value();
    if (v.length !== last.before.length + 1) return -1;
    let k = 0;
    while (k < last.before.length && v[k] === last.before[k]) k++;
    if (v[k] !== "\n" || v.slice(0, k) + v.slice(k + 1) !== last.before) return -1;
    this.quiet = true;
    s.set_value(last.before);
    s.set_selected_range({ start: k, end: k });
    this.quiet = false;
    this.sync();
    return k;
  }

  // Enter in a list item or a quote continues it; Enter on an empty one ends
  // it. False when the textarea should insert the plain newline.
  enter(cx, late = false) {
    const s = this.state;
    if (!s) return false;
    // Late (after the textarea's own newline): look at the text before it.
    const at = late ? this.takeBack() : -1;
    if (late && at < 0) return false;
    const v = s.value();
    const sel = this.selection() ?? { start: v.length, end: v.length };
    const lineStart = v.lastIndexOf("\n", sel.start - 1) + 1;
    let lineEnd = v.indexOf("\n", sel.end);
    if (lineEnd < 0) lineEnd = v.length;
    const line = v.slice(lineStart, lineEnd);
    const item = line.match(ITEM);
    const quote = !item && line.match(QUOTE);
    const m = item || quote;
    if (!m) {
      // Not ours: put the textarea's newline back.
      if (late) this.splice(at, at, "\n", at + 1);
      return false;
    }
    if (!line.slice(m[0].length).trim()) {
      // An empty item: its mark goes, and the list or quote ends here.
      this.splice(lineStart, lineEnd, "", lineStart);
    } else {
      const prefix = quote
        ? m[0].trim() + " "
        : m[1] + (m[2] ?? `${Number(m[3]) + 1}${m[4]}`) + " " + (m[6] ? "[ ] " : "");
      const ins = "\n" + prefix;
      this.splice(sel.start, sel.end, ins, sel.start + ins.length);
    }
    cx.notify();
    return true;
  }

  key(e, cx) {
    if (!this.state) return;
    const k = e.keystroke;
    if (k === "enter") {
      // The textarea already ran this Enter through submit: do not run it twice.
      if (Date.now() - (this.lateAt ?? 0) < 150) { cx.stop_propagation(); return; }
      if (this.enter(cx)) { this.enterAt = Date.now(); cx.stop_propagation(); }
      return;
    }
    if (FORMATS[k]) { this.format(...FORMATS[k], cx); cx.stop_propagation(); }
  }

  // ---- scrolling ----

  // A measured size; redraws only when it moved by half a pixel or more.
  size(key, value, cx) {
    if (Math.abs(this.sizes[key] - value) < 0.5) return;
    this.sizes[key] = value;
    this.redraw(cx);
  }

  // One redraw for a burst of size changes, once they stop. The whole-text
  // work runs here, outside the render, which the app gives little time. The
  // first one waits longer: renders are slow just after the editor opens.
  redraw(cx) {
    const seq = this.seq = (this.seq ?? 0) + 1;
    cx.timer.after(this.settled ? 16 : 300, (cx) => {
      if (seq !== this.seq) return;
      this.settled = true;
      this.prepare();
      cx.notify();
    });
  }

  // The source's column count and row model for the measured sizes.
  prepare() {
    const S = this.sizes;
    const cols0 = Math.max(1, Math.floor((S.srcW - 2 * SRC_PAD - PAD_X) / S.charW));
    const realRows = Math.round((S.srcH - 2 * SRC_PAD - PAD_Y) / S.lineH);
    if (!S.lineH || !S.charW || !S.srcW || !S.srcH) return { r: null, realRows };
    // The fitted column count holds for a width, so it is found again only
    // when the width changes. Below 8 rows the Textarea shows its minimum
    // height, not its text.
    if (realRows > 8 && this.fit?.cols0 !== cols0) this.fit = { cols0, cols: fitCols(this.text.split("\n"), cols0, realRows) };
    const cols = this.fit?.cols0 === cols0 ? this.fit.cols : cols0;
    this.cols = cols;
    const list = this.parsed?.text === this.text ? this.parsed.list : undefined;
    if (this.model?.text !== this.text || this.model.cols !== cols) this.model = { text: this.text, cols, r: rows(this.text, cols, list) };
    return { r: this.model.r, realRows };
  }

  blockHeight(key, value, cx) {
    const old = this.sizes.heights.get(key);
    if (old !== undefined && Math.abs(old - value) < 0.5) return;
    this.sizes.heights.set(key, value);
    this.redraw(cx);
  }

  // After an edit, scrolls the source so the end of the change shows.
  keepVisible(before, after) {
    const { lineH, viewport } = this.sizes;
    if (!this.hasFocus || !lineH) return;
    const i = changedEnd(before, after);
    if (i < 0) return;
    const [r0, r1] = rowRange(rows(after, this.cols ?? 80, []).perLine, lineOf(after, i));
    // One row of slack each way: the source height is a frame old.
    const top = SRC_PAD + PAD_Y + r0 * lineH - lineH;
    const bottom = SRC_PAD + PAD_Y + r1 * lineH + lineH;
    const y = reveal(this.shown.src, top, bottom, viewport);
    if (y !== this.shown.src) this.view = { side: "src", y };
  }

  canMove(side, dy) {
    const max = this.max[side];
    if (max <= 0) return false;
    return dy > 0 ? this.shown[side] < max - 0.5 : this.shown[side] > 0.5;
  }

  // The side under the pointer scrolls and the other follows. Whether the
  // editor takes a gesture is decided at its first real movement and held
  // through its momentum, so the form around it never moves mid-gesture.
  wheel(e, cx) {
    const width = this.sizes.bodyW || e.bounds?.width || 0;
    const x = e.local_position?.x ?? (e.bounds ? e.position.x - e.bounds.x : null);
    const under = x == null || !width ? this.hover : x < width / 2 ? "src" : "pre";
    // Positive: toward the end of the text.
    const dy = -(e.delta_lines ? e.delta_lines.y * (this.sizes.lineH || LINE_FALLBACK) : e.delta.y);
    const now = Date.now();
    let g = this.gesture;
    if (e.touch_phase === "started" || !g || now - g.at > GESTURE_GAP_MS) g = this.gesture = { side: under, latched: null, at: now };
    g.at = now;
    if (g.latched === null && Math.abs(dy) >= 0.5) g.latched = this.canMove(g.side, dy);
    if (!g.latched) return;
    // Several events come in one frame: each builds on the one before.
    const y = clamp(this.shown[g.side] + dy, 0, this.max[g.side]);
    this.shown[g.side] = y;
    this.view = { side: g.side, y };
    cx.stop_propagation();
    cx.notify();
  }

  // The offsets of both sides for this frame.
  scroll(list, keys) {
    const S = this.sizes;
    const { viewport, lineH, charW } = S;
    const srcMax = Math.max(0, S.srcH - viewport);
    // With no text the preview shows its placeholder and does not scroll.
    const preH = this.text.trim() ? S.preH : 0;
    const preMax = Math.max(0, preH - viewport);
    this.max = { src: srcMax, pre: preMax };
    if (!lineH || !charW || !S.srcW || !S.srcH || !viewport) return { src: 0, pre: 0 };
    const { r, realRows } = this.prepare();
    const scale = r.total >= 8 && realRows > 8 ? realRows / r.total : 1;
    const tops = [];
    let top = 0;
    for (const k of keys) { tops.push(top); top += (S.heights.get(k) ?? lineH) + GAP; }
    const srcA = [0, ...list.map((_, i) => Math.min(SRC_PAD + PAD_Y + r.anchors[i] * scale * lineH, S.srcH)), S.srcH];
    const preA = [0, ...tops.map((t) => Math.min(PRE_PAD_Y + t, preH)), preH];
    // The blend runs over the last viewport of travel, or all of it when the
    // side moves less than a viewport, so the top still maps to the top.
    const follow = (y, from, to, fromMax, toMax) =>
      clamp(blendEnd(y, mapOffset(y, from, to), fromMax, toMax, Math.min(viewport, fromMax)), 0, toMax);
    if (this.view.side === "pre") {
      const pre = clamp(this.view.y, 0, preMax);
      return { src: follow(pre, preA, srcA, preMax, srcMax), pre };
    }
    const src = clamp(this.view.y, 0, srcMax);
    return { src, pre: follow(src, srcA, preA, srcMax, preMax) };
  }

  // A thin read-only bar that shows where a side is scrolled.
  indicator(offset, content) {
    const { viewport } = this.sizes;
    if (content <= viewport || !viewport) return null;
    return div().absolute().right(2).w(3).rounded(2).bg(theme().border)
      .top(offset * viewport / content).h(viewport * viewport / content);
  }

  // ---- drawing ----

  tool(key, text, action, opts = {}) {
    const t = theme();
    return div().id(`${this.id}-${key}`).h(22).min_w(24).px(6).flex().items_center().justify_center().rounded(5).flex_none()
      .text_size(11).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .when(Boolean(opts.bold), (el) => el.font_semibold())
      .when(Boolean(opts.italic), (el) => el.italic())
      .when(Boolean(opts.mono), (el) => el.font_family(settings().font_family))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(text);
  }

  render(cx, { focused } = {}) {
    const t = theme();
    const active = focused || this.hasFocus;
    const sep = () => div().w(1).h(14).mx(3).bg(t.border);
    const toolbar = h_flex().flex_none().items_center().gap(1).px(4).py(3).border_b(1).border_color(t.border).bg(t.surface)
      .child(this.tool("b", "B", (cx) => this.format("**", "**", cx), { bold: true }))
      .child(this.tool("i", "I", (cx) => this.format("_", "_", cx), { italic: true }))
      .child(this.tool("c", "</>", (cx) => this.format("`", "`", cx), { mono: true }))
      .child(sep())
      .child(this.tool("h", "H", (cx) => this.lines("heading", cx), { bold: true }))
      .child(this.tool("l", "• List", (cx) => this.lines("list", cx)))
      .child(this.tool("q", "❝ Quote", (cx) => this.lines("quote", cx)))
      .child(sep())
      .child(this.tool("k", "Link", (cx) => this.format("[", "](url)", cx)))
      .child(div().flex_1())
      .child(div().pr(4).text_size(10).text_color(t.dim).child("Preview →"));
    const S = this.sizes;
    // The blocks change only with the text; a render must stay cheap.
    if (this.parsed?.text !== this.text) {
      const list = blocks(this.text);
      const refs = references(this.text, list);
      const md = list.map((b) => refs ? `${b.text}\n\n${refs}` : b.text);
      // A block's height is kept by its content, so a block that moves keeps it.
      const keys = md.map(hash);
      // An edited block keeps its old height until its new one is measured.
      const old = this.parsed?.keys;
      if (old?.length === keys.length) {
        keys.forEach((k, i) => { if (!S.heights.has(k) && S.heights.has(old[i])) S.heights.set(k, S.heights.get(old[i])); });
      }
      const live = new Set(keys);
      for (const k of S.heights.keys()) if (!live.has(k)) S.heights.delete(k);
      this.parsed = { text: this.text, list, md, keys };
    }
    const { list, md, keys } = this.parsed;
    const off = this.scroll(list, keys);
    this.shown = off;
    const font = settings().font_family;
    // Measures the Textarea's character width and line height.
    const probe = div().id(`${this.id}-probe`).absolute().top(-1000).opacity(0).font_family(font).text_size(12.5)
      .on_size_change((sz, cx) => { this.size("charW", sz.width / 10, cx); this.size("lineH", sz.height / 2, cx); })
      .child(div().child("0000000000")).child(div().child("0000000000"));
    const source = v_flex().id(`${this.id}-src`).flex_1().min_w(0).h_full().overflow_hidden().relative().cursor_text()
      .on_click((_e, _cx) => this.state?.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .on_hover((h) => { if (h) this.hover = "src"; })
      .child(probe)
      .child(v_flex().id(`${this.id}-src-wrap`).flex_none().w_full().p(SRC_PAD).mt(-off.src)
        .on_size_change((sz, cx) => { this.size("srcH", sz.height, cx); this.size("srcW", sz.width, cx); })
        .child(this.state
          ? Textarea.new(this.state).w_full().text_size(12.5).text_color(t.foreground).font_family(font)
          : div()))
      .children([this.indicator(off.src, S.srcH)].filter(Boolean));
    const preview = v_flex().id(`${this.id}-pre`).flex_1().min_w(0).h_full().overflow_hidden().relative().bg(t.surface)
      .text_size(12.5).text_color(t.foreground)
      .on_hover((h) => { if (h) this.hover = "pre"; })
      .child(this.text.trim()
        ? v_flex().id(`${this.id}-pre-wrap`).flex_none().w_full().px(PRE_PAD_X).py(PRE_PAD_Y).gap(GAP).mt(-off.pre)
          .on_size_change((sz, cx) => { this.size("preH", sz.height, cx); this.size("preW", sz.width, cx); })
          .children(list.map((_, i) => div().id(`${this.id}-blk-${i}-${keys[i]}`).w_full()
            .on_size_change((sz, cx) => this.blockHeight(keys[i], sz.height, cx))
            .child(TextView.markdown(`${this.id}-md-${i}-${keys[i]}`, md[i]).scrollable(false))))
        : div().px(PRE_PAD_X).py(PRE_PAD_Y).text_color(t.dim).child("The rendered text shows here."))
      .children([this.text.trim() ? this.indicator(off.pre, S.preH) : null].filter(Boolean));
    return v_flex().id(this.id).h(this.height).flex_none().rounded(7).border_1().overflow_hidden()
      .border_color(active ? t.accent : t.input).bg(t.background)
      .child(toolbar)
      .child(h_flex().id(`${this.id}-body`).flex_1().min_h(0)
        .on_size_change((sz, cx) => { this.size("viewport", sz.height, cx); this.size("bodyW", sz.width, cx); })
        .on_scroll_wheel((e, cx) => this.wheel(e, cx))
        .child(source)
        .child(div().w(1).h_full().bg(t.border))
        .child(preview));
  }
}
