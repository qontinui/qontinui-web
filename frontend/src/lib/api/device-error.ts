/**
 * The human-readable message of a `/api/v1/devices` error body.
 *
 * The backend's `http_exception_handler` (`backend/app/middleware/error_handler.py`)
 * rewrites every `HTTPException` to `{error, message, ...}` with no `detail`
 * key — a string detail becomes `message`, and a structured detail such as
 * `DELETE /devices/{id}`'s 409 `device_is_ci_runner` `{error, code, message}`
 * is flattened to the top level. So `message` is the field a caller must
 * read; reading only `detail` showed a generic fallback instead of the
 * refusal. A raw FastAPI body (`detail` a string, or an object carrying its
 * own `message`) is still understood, and an object is never rendered as
 * "[object Object]".
 */
export function deviceApiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const { detail, message, code } = body as {
    detail?: unknown;
    message?: unknown;
    code?: unknown;
  };
  if (typeof detail === "string" && detail) return detail;
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const inner = detail as { message?: unknown };
    if (typeof inner.message === "string" && inner.message)
      return inner.message;
  }
  if (typeof message === "string" && message) return message;
  if (typeof code === "string" && code) return code;
  return fallback;
}
