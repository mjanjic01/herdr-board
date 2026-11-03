// The Machine window: one machine's last hour (load per core, memory pressure,
// swap), its load gate and browser slots right now, and the machine settings
// that decide them. The engine writes machine.json about every 10 s; this view
// reads it only while it is open, and redraws only when a new sample arrived.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, readTextFile } from "herdr";
import { MOD, served, stateOf, request } from "./state.js";
import { button, tiny, label, field, chips, section, titleRow, closeButton } from "./ui.js";

const COLS = 120;          // one column per 30 s
const SPAN = 3600000;      // the last hour
const ROW_H = 54;
const PRESSURE = [{ id: "0", label: "Off" }, { id: "2", label: "Warning" }, { id: "4", label: "Critical" }];

// Theme colors are #rrggbb: add an alpha for shading.
const alpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? `${c}${a}` : c);
const hhmm = (ms) => (ms ? new Date(ms).toTimeString().slice(0, 5) : "?");

// Samples into COLS buckets of 30 s ending now: the max of each, null when empty.
export function buckets(s, now = Date.now()) {
  const out = { load: [], pressure: [], swap: [], gate: [] };
  for (const k of Object.keys(out)) out[k] = new Array(COLS).fill(null);
  if (!s?.t?.length) return out;
  const start = now - SPAN;
  const step = SPAN / COLS;
  s.t.forEach((t, i) => {
    const b = Math.floor((t - start) / step);
    if (b < 0 || b >= COLS) return;
    for (const k of Object.keys(out)) {
      const v = s[k]?.[i];
      if (v != null && (out[k][b] == null || v > out[k][b])) out[k][b] = v;
    }
  });
  return out;
}

export class MachineView extends View {
  init(_props, cx) {
    this.machine = props()?.machine ?? null;
    this.data = {};   // machine -> machine.json
    this.error = "";
    this.busy = false;
    this.focused = null;
    this.makeStates();
    // Read from a timer: a load spawned straight from a dialog's init never finishes.
    const read = (cx) => cx.spawn(async (cx) => {
      if (this.reading) return;
      this.reading = true;
      const m = this.machine;
      try {
        const home = stateOf(m)?.home;
        if (home) {
          const d = JSON.parse(await readTextFile(`${home}/machine.json`, { on: m }));
          if (d?.at !== this.data[m ?? ""]?.at) { this.data[m ?? ""] = d; cx.notify(); }
        }
      } catch {}
      this.reading = false;
    });
    cx.timer.after(40, read);
    cx.timer.every(10000, read);
    this.read = read;
  }

  // The settings fields, filled from the machine's engine settings.
  makeStates() {
    for (const st of Object.values(this.st ?? {})) st.release?.();
    const s = stateOf(this.machine)?.settings ?? {};
    const mk = (key, v, ph) => {
      const st = InputState.new({ value: String(v ?? ""), placeholder: ph });
      st.on("focus", (_e, cx) => { this.focused = key; cx.notify(); });
      st.on("blur", (_e, cx) => { if (this.focused === key) this.focused = null; cx.notify(); });
      return st;
    };
    this.st = {
      niceness: mk("niceness", s.niceness ?? 10, "10"),
      slots: mk("slots", s.heavySlots ?? 1, "1"),
      load: mk("load", s.gateLoad ?? 1.5, "1.5"),
      swap: mk("swap", s.gateSwap ? Math.round(s.gateSwap * 100) : 0, "0"),
      runs: mk("runs", s.maxRuns ?? 20, "20"),
      cleanup: mk("cleanup", s.cleanupDone ?? 30, "30"),
    };
    this.pressure = String(s.gatePressure ?? 2);
  }

  pick(machine, cx) {
    this.machine = machine;
    this.error = "";
    this.makeStates();
    cx.notify();
    this.read(cx);
  }

  close() {
    for (const st of Object.values(this.st ?? {})) st.release?.();
    closeOverlay(props().overlay);
  }

  save(cx) {
    const num = (st, lo, hi, d) => { const n = Number(st.value()); return Number.isFinite(n) && n >= lo ? Math.min(hi, n) : d; };
    const settings = {
      niceness: Math.round(num(this.st.niceness, 0, 19, 10)),
      heavySlots: Math.round(num(this.st.slots, 1, 8, 1)),
      gateLoad: Math.round(num(this.st.load, 0, 16, 1.5) * 10) / 10,
      gatePressure: Number(this.pressure),
      gateSwap: Math.round(num(this.st.swap, 0, 100, 0)) / 100,
      maxRuns: Math.round(num(this.st.runs, 2, 99, 20)),
      cleanupDone: Math.round(num(this.st.cleanup, 0, 1440, 30)),
    };
    this.busy = true; this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { await request(this.machine, { op: "set-settings", settings }); this.saved = Date.now(); }
      catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      cx.notify();
    });
  }

  // One graph row: columns of values, an optional threshold line, gate shading.
  row(id, name, now, cols, gate, opts) {
    const tm = theme();
    const { max, color, line } = opts;
    const bar = (v, i) => {
      const shade = gate[i] ? alpha(tm.blocked, "2e") : null;
      const col = div().id(`${id}-${i}`).flex_1().h_full().flex().flex_col().justify_end().when(Boolean(shade), (el) => el.bg(shade));
      if (v == null) return col;
      if (opts.band) return col.child(div().w_full().h_full().bg(color(v)));
      const h = Math.max(1, Math.min(ROW_H, Math.round((ROW_H * v) / max)));
      return col.child(div().w_full().h(h).bg(color(v)));
    };
    return h_flex().gap(10).items_center()
      .child(v_flex().w(120).flex_none()
        .child(div().text_size(11.5).text_color(tm.muted).child(name))
        .child(div().text_size(13).font_medium().text_color(tm.foreground).child(now)))
      .child(div().id(`${id}-plot`).flex_1().h(ROW_H).relative().rounded(4).bg(tm.surface).overflow_hidden()
        .child(h_flex().size_full().gap(1).children(cols.map(bar)))
        .when(line != null && line > 0 && line <= max, (el) => el.child(
          div().absolute().left(0).right(0).bottom(Math.round((ROW_H * line) / max)).h(1).bg(alpha(tm.blocked, "cc")))));
  }

  graph(d) {
    const tm = theme();
    const s = d?.settings ?? {};
    const b = buckets(d?.samples);
    const n = d?.now ?? {};
    const lpc = n.load1 != null && d?.ncpu ? n.load1 / d.ncpu : null;
    const gateLine = s.gateLoad > 0 ? s.gateLoad * 100 : null;
    const loadMax = Math.max(200, (gateLine ?? 0) * 1.25, ...b.load.filter((v) => v != null));
    // Green, amber, red: the theme's ANSI green and yellow read as such in every theme.
    const pLevel = (v) => (v >= 4 ? tm.blocked : v >= 2 ? (tm.ansi3 ?? tm.done) : (tm.ansi2 ?? tm.working));
    const pWord = (v) => (v == null ? "?" : v >= 4 ? "critical" : v >= 2 ? "warning" : "normal");
    const swapPct = n.swapTotal > 0 ? Math.round((100 * n.swapUsed) / n.swapTotal) : 0;
    return v_flex().gap(8)
      .child(this.row("ld", "Load per core", lpc == null ? "?" : `${lpc.toFixed(2)} (${(n.load1 ?? 0).toFixed(1)} on ${d.ncpu})`,
        b.load, b.gate, { max: loadMax, line: gateLine, color: (v) => (gateLine && v > gateLine ? tm.blocked : alpha(tm.accent, "cc")) }))
      .child(this.row("mp", "Memory pressure", pWord(n.pressure), b.pressure, b.gate, { band: true, max: 1, color: pLevel }))
      .child(this.row("sw", "Swap used", `${swapPct}%`, b.swap, b.gate,
        { max: 100, line: s.gateSwap > 0 ? s.gateSwap * 100 : null, color: (v) => (s.gateSwap > 0 && v > s.gateSwap * 100 ? tm.blocked : alpha(tm.muted, "99")) }))
      .child(h_flex().pl(130).text_size(10.5).text_color(tm.dim)
        .child(div().flex_1().child("-60m")).child(div().flex_1().text_center().child("-30m")).child(div().flex_1().text_right().child("now")))
      .child(div().pl(130).text_size(10.5).text_color(tm.dim).child("Red line: the gate's limit. Red shading: the gate was closed (no new starts)."));
  }

  status(d) {
    const tm = theme();
    const g = d?.gate;
    const open = (id) => openOverlay({ mod: MOD, kind: "dialog", width: 700, height: 740, props: { view: "task", id } });
    const slots = Math.max(1, Number(d?.settings?.heavySlots) || 1);
    const held = d?.slots ?? [];
    return v_flex().gap(4)
      .child(div().text_size(12.5).text_color(g ? tm.blocked : tm.working)
        .child(g ? `Gate closed: ${g.detail} since ${hhmm(g.since)}. No new starts on this machine.` : "Gate open: new starts allowed."))
      .when(Boolean(d?.limitGate), (el) => el.child(div().text_size(12).text_color(tm.muted).child(`Usage limit: no new starts until ${d.limitGate.text}.`)))
      .children(Array.from({ length: slots }, (_, i) => {
        const h = held.find((x) => x.slot === `slot-${i + 1}`) ?? (i === 0 && held.length && !held.some((x) => /^slot-\d+$/.test(x.slot)) ? held[0] : null);
        const row = h_flex().id(`slot-${i}`).gap(8).items_center().text_size(12)
          .child(div().w(110).text_color(tm.muted).child(`Browser slot ${i + 1}`));
        if (!h) return row.child(div().text_color(tm.dim).child("free"));
        return row.child(div().flex_1().min_w(0).truncate().text_color(tm.foreground).when(Boolean(h.task), (el) => el.cursor_pointer().on_click(() => open(h.task)))
          .child(`${h.title ?? h.task ?? "a job outside the board"}${h.since ? ` · since ${hhmm(h.since)}` : ""}`));
      }))
      .when((d?.waiting ?? []).length > 0, (el) => el.child(div().pt(4).text_size(11.5).text_color(tm.muted).child("Waiting:"))
        .children(d.waiting.map((w, i) => h_flex().id(`wait-${i}`).gap(8).text_size(12).cursor_pointer().on_click(() => w.task && open(w.task))
          .child(div().w(110).text_color(tm.dim).child(w.why === "slot" ? "for a slot" : "for the gate"))
          .child(div().flex_1().min_w(0).truncate().text_color(tm.foreground).child(w.title ?? w.task ?? "?")))));
  }

  settingsForm() {
    const tm = theme();
    const f = (key, title, hint, w = 90) => v_flex().flex_1().min_w(0)
      .child(label(title))
      .child(div().w(w).child(field(this.st[key], this.focused === key)))
      .child(div().pt(3).text_size(10.5).text_color(tm.dim).child(hint));
    return v_flex()
      .child(h_flex().gap(16).items_start()
        .child(f("niceness", "Agent priority (nice)", "0 to 19. Agents and all they start run at this priority; 0 = off."))
        .child(f("slots", "Browser slots", "Browser or e2e test runs at once on this machine (board-heavy)."))
        .child(f("runs", "Run limit", "Finished runs per task before the board asks you.")))
      .child(h_flex().gap(16).items_start()
        .child(f("load", "Load gate (× cores)", "No new starts while the load is above this × the cores; 0 = off."))
        .child(v_flex().flex_1().min_w(0)
          .child(label("Memory pressure gate"))
          .child(chips("mp", PRESSURE, this.pressure, (id, cx) => { this.pressure = id; cx.notify(); }))
          .child(div().pt(3).text_size(10.5).text_color(tm.dim).child("No new starts at this memory pressure or worse.")))
        .child(f("swap", "Swap gate (%)", "No new starts above this share of swap used; 0 = off. macOS keeps swap, so keep it off or high.")))
      .child(h_flex().gap(16).items_start()
        .child(f("cleanup", "Clean up after Done (min)", "Idle agent sessions of a task close once it has sat in Done this long; 0 = never."))
        .child(div().flex_1()).child(div().flex_1()));
  }

  render(cx) {
    const tm = theme();
    const machines = served().filter((m) => stateOf(m));
    const d = this.data[this.machine ?? ""];
    return v_flex().id("machine-root").size_full().p(20).bg(tm.popover).text_color(tm.foreground)
      .child(titleRow("Machine", closeButton("machine-close", () => this.close())))
      .child(h_flex().pt(8).gap(10).items_center()
        .child(div().w(70).text_size(11).text_color(tm.dim).child("MACHINE"))
        .child(chips("mc", machines.map((m) => ({ id: m ?? "", label: m ?? "This Mac" })), this.machine ?? "", (id, cx) => this.pick(id || null, cx))))
      .child(v_flex().id("machine-scroll").flex_1().min_h(0).overflow_y_scrollbar().pr(4)
        .child(section("Last hour", d ? div().text_size(10.5).text_color(tm.dim).child(`updated ${hhmm(d.at)}`) : null))
        .child(d ? this.graph(d) : div().text_size(12).text_color(tm.dim).child("Waiting for the engine's first sample (about 10 seconds)…"))
        .child(section("Now"))
        .child(d ? this.status(d) : div())
        .child(section("Settings for this machine"))
        .child(this.settingsForm()))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(12).text_color(tm.blocked).child(this.error)))
      .child(h_flex().pt(12).gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(tm.dim).child(this.saved ? `Saved at ${hhmm(this.saved)}.` : "Board settings per board stay in Board setup and notes…"))
        .child(button("machine-done", "Close", () => this.close()))
        .child(button("machine-save", this.busy ? "Saving…" : "Save", (_e, cx) => this.save(cx), { primary: true, disabled: this.busy || !stateOf(this.machine) })));
  }
}
