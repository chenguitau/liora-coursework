import { withRequestId } from "./request-id.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("request id is omitted when the header is absent", () => {
  assert.equal(withRequestId("内部错误", null), "内部错误");
  assert.equal(withRequestId("内部错误", undefined), "内部错误");
  assert.equal(withRequestId("内部错误", ""), "内部错误");
});

test("request id is appended to the message", () => {
  assert.equal(withRequestId("内部错误", "a1b2c3d4"), "内部错误（请求 ID a1b2c3d4）");
});

test("request id already present is not appended twice", () => {
  assert.equal(withRequestId("内部错误（请求 ID a1b2c3d4）", "a1b2c3d4"), "内部错误（请求 ID a1b2c3d4）");
  assert.equal(withRequestId("trace a1b2c3d4 failed", "a1b2c3d4"), "trace a1b2c3d4 failed");
});

test("blank request id is treated as missing", () => {
  assert.equal(withRequestId("内部错误", "   "), "内部错误");
  assert.equal(withRequestId("内部错误", "\t\n"), "内部错误");
});
