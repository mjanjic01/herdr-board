// node --test mods/board/note.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteOf, plain, clip } from "./note.js";

const running = (blocked) => [{ id: "r1", blocked }];

test("noteOf: splits on the active run's summary", () => {
  assert.deepEqual(noteOf({ attention: "Ana needs you: Pick A or B", runs: running("Pick A or B") }), { head: "Ana needs you", body: "Pick A or B" });
});

test("noteOf: no active run falls back to the prefix", () => {
  assert.deepEqual(noteOf({ attention: "Ana needs you: Pick A or B" }), { head: "Ana needs you", body: "Pick A or B" });
  assert.deepEqual(noteOf({ attention: "Ana needs you: Pick A or B", runs: [{ id: "r1", ended: 1, blocked: "x" }] }), { head: "Ana needs you", body: "Pick A or B" });
});

test("noteOf: a name with a space", () => {
  assert.deepEqual(noteOf({ attention: "Ana Lee needs you: Pick A or B" }), { head: "Ana Lee needs you", body: "Pick A or B" });
});

test("noteOf: the engine's own notes have no head", () => {
  assert.deepEqual(noteOf({ attention: "Cannot start Bo: boom" }), { head: null, body: "Cannot start Bo: boom" });
  const wait = "Bo is waiting for you in its terminal (a question or a permission). Peek to answer.";
  assert.deepEqual(noteOf({ attention: wait }), { head: null, body: wait });
});

test("noteOf: a summary with a colon and newlines", () => {
  const sum = "Review is in x.md.\nQuestion: A or B?";
  assert.deepEqual(noteOf({ attention: `Cy needs you: ${sum}`, runs: running(sum) }), { head: "Cy needs you", body: sum });
  assert.deepEqual(noteOf({ attention: `Cy needs you: ${sum}` }), { head: "Cy needs you", body: sum });
});

test("noteOf: no note", () => {
  assert.deepEqual(noteOf({ attention: null }), { head: null, body: "" });
  assert.deepEqual(noteOf(null), { head: null, body: "" });
});

test("plain: strips markdown to one line", () => {
  assert.equal(plain("## Pick one\n- **A**: keep\n- B: drop\n\n```\ncode\n```\nSee [the doc](x.md)."), "Pick one A: keep B: drop code See the doc.");
  assert.equal(plain("a  b\n\n\tc"), "a b c");
  assert.equal(plain("- [x] done\n> quoted\n1. first ![pic](p.png)"), "done quoted first pic");
  assert.equal(plain(null), "");
});

test("clip: cuts at a space, hard cut without one", () => {
  assert.equal(clip("one two three", 8), "one two…");
  assert.equal(clip("short", 8), "short");
  assert.equal(clip("x".repeat(20), 8), "xxxxxxxx…");
});
