import { isTaskNotFoundError } from "./task-not-found.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("recognizes the backend task-not-found message", () => {
  assert.equal(isTaskNotFoundError(new Error("task not found")), true);
});

test("recognizes a 404 status fallback from a non-JSON error body", () => {
  assert.equal(isTaskNotFoundError(new Error("GET /exploration/findings?task=1: 404")), true);
});

test("does not treat other failures as a missing task", () => {
  assert.equal(isTaskNotFoundError(new Error("GET /exploration/findings?task=1: 500")), false);
  assert.equal(isTaskNotFoundError(new Error("加载失败")), false);
  assert.equal(isTaskNotFoundError(new Error("1404")), false);
  assert.equal(isTaskNotFoundError(null), false);
});
