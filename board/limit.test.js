// node --test mods/board/limit.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { limitLine } from "./limit.js";

test("the reset time when Claude printed one", () => {
  assert.equal(limitLine({ until: "10pm", auto: true }), "Usage limit reached · Claude continues at 10pm");
});

test("the reset without a time", () => {
  assert.equal(limitLine({ until: null, auto: true }), "Usage limit reached · Claude continues after the reset");
});
