// reportErrorMessage turns a failed GET /api/report response into the message the
// report tab shows. The handler returns {"error": "..."} with a 500 when a
// database read fails; that reason must reach the user instead of a bare status,
// because "暂无报告" and "读取发现失败" are different outcomes.
export function reportErrorMessage(status: number, body: string): string {
  const fallback = `报告加载失败（HTTP ${status}）`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // Non-JSON error body: keep the status-based message.
  }
  return fallback;
}
