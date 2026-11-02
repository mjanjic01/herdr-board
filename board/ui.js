// Small pieces every board view draws the same way.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Input, Textarea } from "gpui-base";
import { theme } from "herdr";
import { isImage, fmtSize, MOD } from "./state.js";

export const SPINNER = `mods/${MOD}/spinner.svg`;

export const colorOf = (t, name) => t[name] ?? name ?? t.accent;

export function button(id, text, action, opts = {}) {
  const t = theme();
  const primary = opts.primary;
  const danger = opts.danger;
  return h_flex().id(id).h(opts.h ?? 28).px(opts.px ?? 10).items_center().gap(6).rounded(7).flex_none()
    .border_1().border_color(primary ? t.solid : danger ? t.blocked : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : danger ? t.blocked : t.foreground)
    .text_size(opts.size ?? 12).font_medium()
    .when(opts.disabled, (el) => el.opacity(0.45))
    // The press stays on the button: a card around it must not take it as the
    // start of a drag (an action that opens a tab never lets the card see the release).
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .when(!opts.disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((e, cx) => { cx.stop_propagation(); action(e, cx); }))
    .when(Boolean(opts.icon), (el) => el.child(opts.icon))
    .child(text);
}

export function tiny(id, text, action, opts = {}) {
  return button(id, text, action, { h: 22, px: 7, size: 11, ...opts });
}

export const label = (text) => div().pt(12).pb(5).text_size(11).text_color(theme().dim).child(text);

export function field(state, focused, opts = {}) {
  const t = theme();
  return Input.new(state).h(opts.h ?? 32).px(10).items_center().rounded(7).border_1()
    .border_color(focused ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
}

export function area(state, focused, h = 120) {
  const t = theme();
  return Textarea.new(state).h(h).p(8).rounded(7).border_1()
    .border_color(focused ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
}

export const dot = (color, size = 8) => div().flex_none().w(size).h(size).rounded_full().bg(color);

// A team member as a small chip: colored dot, name, role dimmed.
export function memberChip(m, opts = {}) {
  const t = theme();
  if (!m) return h_flex().items_center().gap(5).text_size(11.5).text_color(t.dim).child("unassigned");
  return h_flex().items_center().gap(5).text_size(11.5)
    .when(Boolean(opts.id), (el) => el.id(opts.id))
    .when(Boolean(opts.selected), (el) => el.px(7).py(3).rounded(6).bg(t.selected))
    .when(Boolean(opts.id) && !opts.selected, (el) => el.px(7).py(3).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)))
    .when(Boolean(opts.action), (el) => el.on_click((e, cx) => { cx.stop_propagation(); opts.action(e, cx); }))
    .child(dot(colorOf(t, m.color)))
    .child(div().text_color(t.foreground).font_medium().child(m.name))
    .when(!opts.short, (el) => el.child(div().text_color(t.dim).child(m.role)));
}

// A program's icon from the app's table (the known agents list), or nothing.
export function programIcon(p, size = 13) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(theme().muted) : image(p.icon).w(size).h(size).flex_none();
}

// A live agent status as a glyph: spinner, a colored dot, or a check.
export function statusGlyph(status, size = 12) {
  const t = theme();
  if (status === "working") return svg(SPINNER).size(size).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().flex_none().w(size).h(size).rounded_full().bg(t.blocked).loop("opacity", { from: 0.45, to: 1, period: 1200 });
  if (status === "done") return div().flex_none().w(size).h(size).rounded_full().bg(t.done);
  if (status === "idle") return div().flex_none().w(size).h(size).rounded_full().border_1().border_color(t.idle);
  // Waiting for a usage limit to reset: slower and greyer than blocked.
  if (status === "limited") return div().flex_none().w(size).h(size).rounded_full().bg(t.muted).loop("opacity", { from: 0.35, to: 0.9, period: 2400 });
  return null;
}

export const STATUS_WORDS = { working: "working", blocked: "needs you", done: "finished", idle: "idle", limited: "usage limit" };

export function section(title, right) {
  const t = theme();
  return h_flex().items_center().pt(14).pb(6)
    .child(div().flex_1().text_size(11).font_semibold().text_color(t.dim).child(title.toUpperCase()))
    .when(Boolean(right), (el) => el.child(right));
}

// A choice row of chips; `items` are { id, label, color? }, `on` the selected id.
export function chips(prefix, items, on, pick, opts = {}) {
  const t = theme();
  return h_flex().flex_wrap().gap(6).children(items.map((it) => {
    const selected = opts.multi ? on.includes(it.id) : on === it.id;
    return h_flex().id(`${prefix}-${it.id}`).h(24).px(8).items_center().gap(5).rounded(6).text_size(11.5).cursor_pointer()
      .border_1().border_color(selected ? t.accent : t.input).bg(selected ? t.selected : t.raised)
      .text_color(it.disabled ? t.dim : t.foreground)
      .when(!it.disabled, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((e, cx) => { cx.stop_propagation(); if (!it.disabled) pick(it.id, cx); })
      .when(Boolean(it.color), (el) => el.child(dot(colorOf(t, it.color), 7)))
      .when(Boolean(it.icon), (el) => el.child(it.icon))
      .child(it.label);
  }));
}

// One attachment: a thumbnail for images, the name and the size; `open` on
// click, `remove` as a small ×.
export function fileChip(id, att, opts = {}) {
  const t = theme();
  const pic = isImage(att.name);
  return v_flex().id(id).relative().w(pic ? 132 : 170).flex_none().gap(4).p(6).rounded(7).border_1().border_color(t.input).bg(t.raised)
    .when(Boolean(opts.open), (el) => el.cursor_pointer().hover((s) => s.border_color(t.accent)).on_click((e, cx) => { cx.stop_propagation(); opts.open(e, cx); }))
    .when(pic, (el) => el.child(div().h(56).w_full().rounded(5).overflow_hidden().bg(t.background).flex().items_center().justify_center()
      .child(image(att.path).h(56))))
    .child(h_flex().items_center().gap(5).text_size(11).pr(opts.remove && !pic ? 16 : 0)
      .when(!pic, (el) => el.child(div().flex_none().text_color(t.dim).child("📄")))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(att.name)))
    .child(div().text_size(10).text_color(t.dim).child(fmtSize(att.size ?? 0)))
    .when(Boolean(opts.remove), (el) => el.child(div().id(`${id}-x`).absolute().top(4).right(4).size(18).rounded(9).bg(t.popover)
      .border_1().border_color(t.border).text_color(t.foreground).flex().items_center().justify_center().text_size(11).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((e, cx) => { cx.stop_propagation(); opts.remove(e, cx); }).child("×")));
}

// The ✕ that closes a dialog, drawn where the "esc" hint used to be.
export function closeButton(id, action, opts = {}) {
  const t = theme();
  return div().id(id).flex_none().w(26).h(26).rounded(6).flex().items_center().justify_center()
    .text_size(14).text_color(t.dim)
    .when(opts.disabled, (el) => el.opacity(0.45))
    .when(!opts.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); }))
    .child("✕");
}

export const titleRow = (title, right) => h_flex().items_center().gap(8)
  .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(theme().foreground).child(title))
  .when(Boolean(right), (el) => el.child(right));

export const v = v_flex;
export const h = h_flex;
