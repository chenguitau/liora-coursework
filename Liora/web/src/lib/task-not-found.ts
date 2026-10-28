// 后端对不存在的任务返回 404 {"error":"task not found"}。api.ts 的契约只上抛 message，
// 因此这里同时识别该消息与非 JSON 错误体的 404 兜底文案（如 "GET /x: 404"）。
export function isTaskNotFoundError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).trim().toLowerCase();
  return message === "task not found" || /\b404\b/.test(message);
}
