// The attention note split for the screen. No imports, so node --test loads it.
// The engine writes "<name> needs you: <summary>".

const activeRun = (t) => [...(t?.runs ?? [])].reverse().find((r) => !r.ended && !r.result) ?? null;

// head: the part before the summary ("Ana needs you"), null when there is no known summary.
// body: the summary, else the whole note.
export function noteOf(t) {
  const note = t?.attention ?? "";
  const sum = activeRun(t)?.blocked ?? "";
  if (sum && note.endsWith(sum) && note.length > sum.length) {
    const head = note.slice(0, note.length - sum.length).replace(/:\s*$/, "");
    return { head, body: sum };
  }
  const m = note.match(/^(.+? needs you): ([\s\S]+)$/);
  return m ? { head: m[1], body: m[2] } : { head: null, body: note };
}

// Markdown as one line of plain text, for a card.
export function plain(md) {
  return String(md ?? "")
    .split("\n")
    .filter((l) => !/^\s*(```|~~~)/.test(l)) // fence lines go
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)+/, "")) // headings, list items, task boxes, quotes
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/(\*\*|__|`)/g, "") // bold, code
    .replace(/\s+/g, " ")
    .trim();
}

// At most max characters, cut at the last space, with an ellipsis.
export function clip(text, max) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max);
  return s.slice(0, cut > max / 2 ? cut : max).trimEnd() + "…";
}
