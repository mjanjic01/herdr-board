// node --test mods/board/mdsync.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, references, wrapRows, rows, fitCols, mapOffset, blendEnd, changedEnd, lineOf, rowRange, reveal } from "./mdsync.js";

const spans = (text) => blocks(text).map((b) => [b.start, b.end]);

test("blocks: a blank line ends a paragraph", () => {
  assert.deepEqual(spans("one\ntwo\n\nthree"), [[0, 2], [3, 4]]);
  assert.equal(blocks("one\ntwo\n\nthree")[0].text, "one\ntwo");
});

test("blocks: a heading is a block of its own", () => {
  assert.deepEqual(spans("text\n## Head\nmore"), [[0, 1], [1, 2], [2, 3]]);
});

test("blocks: a fence keeps its blank lines", () => {
  assert.deepEqual(spans("a\n```js\nx\n\ny\n```\nb"), [[0, 1], [1, 6], [6, 7]]);
  assert.deepEqual(spans("```\nopen\n\nto the end"), [[0, 4]]);
});

test("blocks: an indented line after blanks continues a list", () => {
  assert.deepEqual(spans("- item\n\n  more\n\npara"), [[0, 3], [4, 5]]);
  assert.deepEqual(spans("para\n\n  indented"), [[0, 1], [2, 3]]);
});

test("blocks: blank text has none", () => {
  assert.deepEqual(blocks(""), []);
  assert.deepEqual(blocks("\n\n  \n"), []);
});

test("references: every definition outside code", () => {
  const text = "see [a]\n\n[a]: https://a.example\n\n```\n[b]: not\n```\n[c]: https://c.example";
  assert.equal(references(text), "[a]: https://a.example\n[c]: https://c.example");
});

test("wrapRows: word wrap, not character wrap", () => {
  assert.equal(wrapRows("aaaaaa bbbbbb cccccc", 10), 3);
  assert.equal(wrapRows("x".repeat(25), 10), 3);
  assert.equal(wrapRows("", 10), 1);
  assert.equal(wrapRows("  - item", 8), 1);
});

test("wrapRows: a word keeps its space on the row, as the Textarea does", () => {
  // Measured: 500 characters of "abcde " at 41 columns is 14 rows; 500 x is 13.
  const words = Array.from({ length: 84 }, () => "abcde").join(" ").slice(0, 500);
  assert.equal(wrapRows(words, 41), 14);
  assert.equal(wrapRows("x".repeat(500), 41), 13);
  assert.equal(wrapRows("\tab", 4), 2);
});

test("rows: anchors where each block starts, then the total", () => {
  const r = rows("aaaa aaaa\n\n# H\nbb", 5);
  assert.deepEqual(r.perLine, [2, 1, 1, 1]);
  assert.deepEqual(r.anchors, [0, 3, 4, 5]);
  assert.equal(r.total, 5);
});

test("fitCols: picks the column count that matches the measured rows", () => {
  const lines = ["aaaa bbbb cccc dddd"];
  // At 10 columns: 2 rows ("aaaa bbbb " and "cccc dddd"); at 9: 3 rows.
  assert.equal(wrapRows(lines[0], 10), 2);
  assert.equal(wrapRows(lines[0], 9), 3);
  assert.equal(fitCols(lines, 9, 2), 10);
  assert.equal(fitCols(["x".repeat(30)], 9, 3), 10);
  assert.equal(fitCols(["x".repeat(30)], 10, 3), 10);
  // A tie keeps cols.
  assert.equal(fitCols(["abc"], 10, 1), 10);
});

test("mapOffset", () => {
  const from = [0, 10, 50];
  const to = [0, 20, 100];
  assert.equal(mapOffset(0, from, to), 0);
  assert.equal(mapOffset(3, from, to), 6);
  assert.equal(mapOffset(10, from, to), 20);
  assert.equal(mapOffset(30, from, to), 60);
  assert.equal(mapOffset(50, from, to), 100);
  assert.equal(mapOffset(80, from, to), 100);
  assert.equal(mapOffset(-5, from, to), 0);
  assert.equal(mapOffset(10, [0, 10, 10, 20], [0, 5, 9, 30]), 9);
  assert.equal(mapOffset(5, [0, 10, 10, 20], [0, 5, 9, 30]), 2.5);
});

test("blendEnd", () => {
  assert.equal(blendEnd(100, 150, 400, 600, 200), 150);
  assert.equal(blendEnd(400, 500, 400, 600, 200), 600);
  assert.equal(blendEnd(300, 500, 400, 600, 200), 550);
  assert.equal(blendEnd(300, 100, 400, 80, 200), 90);
  assert.equal(blendEnd(300, 100, 400, 80, 0), 100);
});

test("changedEnd", () => {
  assert.equal(changedEnd("abc", "abcde"), 5);
  assert.equal(changedEnd("abef", "abcdef"), 4);
  assert.equal(changedEnd("abcdef", "abef"), 2);
  assert.equal(changedEnd("hello world", "hello there world"), 12);
  assert.equal(changedEnd("a SEL b", "a pasted text b"), 13);
  assert.equal(changedEnd("same", "same"), -1);
  assert.equal(changedEnd("aaa", "aaaa"), 4);
});

test("lineOf", () => {
  assert.equal(lineOf("a\nb\nc", 0), 0);
  assert.equal(lineOf("a\nb\nc", 2), 1);
  assert.equal(lineOf("a\nb\nc", 5), 2);
});

test("rowRange and reveal", () => {
  assert.deepEqual(rowRange([2, 1, 3], 0), [0, 2]);
  assert.deepEqual(rowRange([2, 1, 3], 2), [3, 6]);
  // Above the viewport: scroll up to its top.
  assert.equal(reveal(100, 40, 60, 200), 40);
  // Inside: stay.
  assert.equal(reveal(100, 120, 160, 200), 100);
  // Below: scroll so its bottom is the viewport's bottom.
  assert.equal(reveal(100, 300, 340, 200), 140);
});
