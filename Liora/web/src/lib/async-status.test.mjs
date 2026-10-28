import { deriveAsyncView } from "./async-status.ts";
import assert from "node:assert/strict";
import test from "node:test";

const failure = new Error("network down");

test("首载没有数据时出骨架，不能提前渲染空态", () => {
  const view = deriveAsyncView({ hasData: false, pending: true, error: null, isEmpty: true });
  assert.equal(view.status, "loading");
  assert.equal(view.showSkeleton, true);
  assert.equal(view.showContent, false);
  assert.equal(view.showError, false);
  assert.equal(view.showStaleError, false);
  assert.equal(view.refreshing, false);
  assert.equal(view.showEmpty, false);
});

test("首载失败且无数据时整块报错", () => {
  const view = deriveAsyncView({ hasData: false, pending: false, error: failure });
  assert.equal(view.status, "error");
  assert.equal(view.showError, true);
  assert.equal(view.showSkeleton, false);
  assert.equal(view.showStaleError, false);
  assert.equal(view.showContent, false);
});

test("已有数据刷新时保持 ready，只标记 refreshing", () => {
  const view = deriveAsyncView({ hasData: true, pending: true, error: null });
  assert.equal(view.status, "ready");
  assert.equal(view.refreshing, true);
  assert.equal(view.showSkeleton, false);
  assert.equal(view.showStaleError, false);
  assert.equal(view.showContent, true);
});

test("已有数据刷新失败时保留内容，只出陈旧错误提示", () => {
  const view = deriveAsyncView({ hasData: true, pending: false, error: failure });
  assert.equal(view.status, "ready");
  assert.equal(view.showStaleError, true);
  assert.equal(view.showError, false);
  assert.equal(view.showSkeleton, false);
  assert.equal(view.refreshing, false);
  assert.equal(view.showContent, true);
});

test("有数据但为空时展示空态而不是骨架", () => {
  const view = deriveAsyncView({ hasData: true, pending: false, error: null, isEmpty: true });
  assert.equal(view.status, "ready");
  assert.equal(view.showEmpty, true);
  assert.equal(view.showContent, true);
  assert.equal(view.showSkeleton, false);
  assert.equal(view.showError, false);
});

test("空列表刷新时仍展示空态，并提示更新中", () => {
  const view = deriveAsyncView({ hasData: true, pending: true, error: null, isEmpty: true });
  assert.equal(view.status, "ready");
  assert.equal(view.refreshing, true);
  assert.equal(view.showEmpty, true);
  assert.equal(view.showSkeleton, false);
});
