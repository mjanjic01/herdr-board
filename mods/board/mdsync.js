// Scroll sync for the markdown editor: splits the source into blocks, estimates
// how many rows each source line wraps to, and maps an offset on one side to
// the other between per-block anchors. Pure: no gpui-kit, no herdr, so
// `node --test mods/board/mdsync.test.js` runs it.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^#{1,6}(\s|$)/;
// A block that a following indented line continues: a list item or a quote.
const LISTISH = /^\s*(?:(?:[-*+]|\d+[.)])(?:\s|$)|>)/;
const REFERENCE = /^ {0,3}\[[^\]]+\]:\s*\S/;

const closesFence = (line, open) => {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return Boolean(m) && m[1][0] === open[0] && m[1].length >= open.length;
};

// The blocks of a markdown text by source line: [{start, end, text}], end
// exclusive. A fenced code block is one block, blank lines included; a blank
// line ends a block; a heading is a block of its own; an indented line after
// blank lines continues a list or quote block.
export function blocks(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  let cur = null;
  let fence = null;
  let blank = false;
  const close = (end) => { if (cur) { cur.end = end; out.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (closesFence(line, fence)) { close(i + 1); fence = null; }
      continue;
    }
    const f = line.match(FENCE);
    if (f) { close(i); cur = { start: i }; fence = f[1]; blank = false; continue; }
    if (!line.trim()) { close(i); blank = true; continue; }
    if (HEADING.test(line)) { close(i); out.push({ start: i, end: i + 1 }); blank = false; continue; }
    if (blank && !cur && /^ {2,}\S/.test(line) && out.length && LISTISH.test(lines[out[out.length - 1].start])) {
      cur = { start: out.pop().start };
      blank = false;
      continue;
    }
    if (!cur) cur = { start: i };
    blank = false;
  }
  close(lines.length);
  return out.map((b) => ({ ...b, text: lines.slice(b.start, b.end).join("\n") }));
}

// Every link reference definition outside code blocks, joined by newlines.
export function references(text, list = blocks(text)) {
  const refs = [];
  for (const b of list) {
    if (FENCE.test(b.text)) continue;
    for (const line of b.text.split("\n")) if (REFERENCE.test(line)) refs.push(line);
  }
  return refs.join("\n");
}

// How many rows one source line takes at `cols` columns, wrapped like the
// Textarea: at spaces, a word keeping the space after it on its row (the last
// word of the line needs no space), a word longer than a row cut by characters,
// a tab as 4 columns. An empty line is 1 row.
export function wrapRows(line, cols) {
  const c = Math.max(1, Math.floor(cols) || 1);
  const pieces = String(line ?? "").replace(/\t/g, "    ").match(/\s*\S+\s*/g);
  if (!pieces) return 1;
  let rows = 1;
  let used = 0;
  pieces.forEach((p, k) => {
    const w = k === pieces.length - 1 ? p.trimEnd().length : p.length;
    if (used > 0 && used + w > c) { rows++; used = 0; }
    if (w > c) {
      rows += Math.ceil(w / c) - 1;
      used = w % c || c;
    } else {
      used += w;
    }
  });
  return rows;
}

// Rows per line, the row at which each block starts, and the total; the last
// anchor is the total.
export function rows(text, cols, list = blocks(text)) {
  const perLine = String(text ?? "").split("\n").map((l) => wrapRows(l, cols));
  const before = [0];
  for (const n of perLine) before.push(before[before.length - 1] + n);
  const total = before[before.length - 1];
  return { perLine, anchors: [...list.map((b) => before[b.start]), total], total };
}

// The column count within 2 of `cols` whose row total is nearest the measured
// one; a tie keeps the one nearer `cols`.
export function fitCols(lines, cols, realRows) {
  const total = (c) => lines.reduce((sum, l) => sum + wrapRows(l, c), 0);
  let best = cols;
  let diff = Math.abs(total(cols) - realRows);
  for (const c of [cols - 1, cols + 1, cols - 2, cols + 2]) {
    if (c < 1) continue;
    const d = Math.abs(total(c) - realRows);
    if (d < diff) { best = c; diff = d; }
  }
  return best;
}

// Maps y between two increasing anchor lists of the same length,
// piecewise-linearly; the last anchor of each is its content height.
export function mapOffset(y, from, to) {
  const n = from.length;
  if (!n) return 0;
  const v = Math.min(Math.max(y, 0), from[n - 1]);
  if (v >= from[n - 1]) return to[n - 1];
  for (let i = 0; i < n - 1; i++) {
    if (v >= from[i] && v < from[i + 1]) {
      const span = from[i + 1] - from[i];
      if (span <= 0) return to[i];
      return to[i] + ((v - from[i]) / span) * (to[i + 1] - to[i]);
    }
  }
  return to[0];
}

// Over the last viewport of travel, blends the mapped offset into the other
// side's end, so both sides reach their ends together without a jump.
export function blendEnd(y, mapped, fromMax, toMax, viewport) {
  if (viewport <= 0 || fromMax - y >= viewport) return mapped;
  const t = 1 - (fromMax - y) / viewport;
  return mapped + t * (toMax - mapped);
}

// The end of the inserted text in `after` (where the caret is after an edit);
// the deletion point for a pure deletion; -1 when nothing changed.
export function changedEnd(before, after) {
  if (before === after) return -1;
  const min = Math.min(before.length, after.length);
  let p = 0;
  while (p < min && before[p] === after[p]) p++;
  let s = 0;
  while (p + s < min && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return p + (after.length - p - s);
}

// The line index of a string index.
export function lineOf(text, index) {
  let n = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

// The rows [first, after last] that one line takes.
export function rowRange(perLine, line) {
  let r0 = 0;
  for (let i = 0; i < line && i < perLine.length; i++) r0 += perLine[i];
  return [r0, r0 + (perLine[line] ?? 0)];
}

// The offset that shows top..bottom in a viewport now at y: y when it is
// already shown, else the nearest offset that shows it.
export function reveal(y, top, bottom, viewport) {
  if (top >= y && bottom <= y + viewport) return y;
  if (top < y) return top;
  return bottom - viewport;
}
