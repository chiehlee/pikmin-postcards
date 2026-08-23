export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    const error = new Error("管理操作只接受同源請求");
    error.status = 403;
    throw error;
  }
}

export function jsonResponse(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = error instanceof Error ? error.message : "管理操作失敗";
  return jsonResponse({ error: message }, status);
}
