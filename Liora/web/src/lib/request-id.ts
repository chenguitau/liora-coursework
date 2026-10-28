// withRequestId appends the backend's X-Request-Id to an error message so a user's
// screenshot can be matched with the server log entry for the same request.
// A missing or blank id (proxy error, request never reached the backend) leaves
// the message untouched, and an id already present in the message is not
// appended a second time.
export function withRequestId(message: string, requestId: string | null | undefined): string {
  const id = requestId?.trim();
  if (!id) return message;
  if (message.includes(id)) return message;
  return `${message}（请求 ID ${id}）`;
}
