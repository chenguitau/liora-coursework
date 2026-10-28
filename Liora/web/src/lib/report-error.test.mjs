import { reportErrorMessage } from "./report-error.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("report error keeps the server reason", () => {
  assert.equal(
    reportErrorMessage(500, '{"error":"读取发现失败: database is closed"}'),
    "读取发现失败: database is closed",
  );
});

test("report error falls back to status for non-JSON and empty bodies", () => {
  assert.equal(reportErrorMessage(500, ""), "报告加载失败（HTTP 500）");
  assert.equal(reportErrorMessage(502, "<html>bad gateway</html>"), "报告加载失败（HTTP 502）");
});

test("report error ignores non-string or blank error fields", () => {
  assert.equal(reportErrorMessage(500, '{"error":42}'), "报告加载失败（HTTP 500）");
  assert.equal(reportErrorMessage(500, '{"error":"   "}'), "报告加载失败（HTTP 500）");
});
