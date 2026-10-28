import { fmtBytes, fmtDuration, fmtTime, fmtTokens } from "./format.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("fmtBytes：0/1023 保持字节，1024 起进 KB，1MB 起进 MB", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(1023), "1023 B");
  assert.equal(fmtBytes(1024), "1.0 KB");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(1024 * 1024 - 1), "1024.0 KB");
  assert.equal(fmtBytes(1.5 * 1024 * 1024), "1.5 MB");
});

test("fmtTokens：999/1000 切档，1.2M 保留一位小数", () => {
  assert.equal(fmtTokens(0), "0");
  assert.equal(fmtTokens(999), "999");
  assert.equal(fmtTokens(1000), "1.0k");
  assert.equal(fmtTokens(9999), "10.0k");
  assert.equal(fmtTokens(10000), "10k");
  assert.equal(fmtTokens(1_200_000), "1.2M");
  assert.equal(fmtTokens(20_000_000), "20M");
});

test("fmtTime：short 输出 MM/DD HH:mm", () => {
  assert.equal(fmtTime("2026-10-21T12:34:56", "short"), "10/21 12:34");
  assert.equal(fmtTime("2026-01-02T03:04:05"), "01/02 03:04");
});

test("fmtTime：datetime 输出 YYYY-MM-DD HH:mm:ss", () => {
  assert.equal(fmtTime("2026-10-21T12:34:56", "datetime"), "2026-10-21 12:34:56");
  assert.equal(fmtTime(new Date(2026, 0, 2, 3, 4, 5), "datetime"), "2026-01-02 03:04:05");
});

test("fmtTime：seconds 输出 MM/DD HH:mm:ss", () => {
  assert.equal(fmtTime("2026-10-21T12:34:56", "seconds"), "10/21 12:34:56");
});

test("fmtTime：空值与非法时间统一返回 —", () => {
  assert.equal(fmtTime(null), "—");
  assert.equal(fmtTime(undefined, "datetime"), "—");
  assert.equal(fmtTime("", "seconds"), "—");
  assert.equal(fmtTime("not-a-date"), "—");
  assert.equal(fmtTime(new Date(Number.NaN), "datetime"), "—");
});

test("fmtTime：接受时间戳数字（毫秒）", () => {
  const ts = new Date(2026, 9, 21, 12, 34, 56).getTime();
  assert.equal(fmtTime(ts, "datetime"), "2026-10-21 12:34:56");
});

test("fmtDuration：sec 单位沿用 tasks 排版（1m 30s / 1d 1h）", () => {
  assert.equal(fmtDuration(0, "sec"), "—");
  assert.equal(fmtDuration(45, "sec"), "45s");
  assert.equal(fmtDuration(90, "sec"), "1m 30s");
  assert.equal(fmtDuration(3700, "sec"), "1h 1m");
  assert.equal(fmtDuration(90000, "sec"), "1d 1h");
});

test("fmtDuration：ms 单位沿用 sessions 排版（1m30s / 1h01m）", () => {
  assert.equal(fmtDuration(0, "ms"), "0s");
  assert.equal(fmtDuration(45000, "ms"), "45s");
  assert.equal(fmtDuration(90000, "ms"), "1m30s");
  assert.equal(fmtDuration(3_700_000, "ms"), "1h01m");
});

test("非法数值兜底：NaN / Infinity / 负数不渲染成 NaN", () => {
  assert.equal(fmtBytes(Number.NaN), "—");
  assert.equal(fmtBytes(-1), "—");
  assert.equal(fmtBytes(Number.POSITIVE_INFINITY), "—");
  assert.equal(fmtTokens(Number.NaN), "—");
  assert.equal(fmtTokens(-5), "—");
  assert.equal(fmtDuration(Number.NaN, "sec"), "—");
  assert.equal(fmtDuration(-1, "ms"), "—");
  assert.equal(fmtDuration(Number.POSITIVE_INFINITY, "ms"), "—");
});
