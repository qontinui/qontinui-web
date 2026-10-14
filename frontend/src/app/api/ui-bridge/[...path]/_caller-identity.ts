/**
 * Caller-identity helpers for the UI Bridge relay route.
 *
 * Lives in a private (`_`-prefixed) sibling module, NOT in `route.ts`, because
 * Next.js App Router route files may only export route handlers + config — an
 * arbitrary `export function` there fails the generated route-type check
 * (`TS2344` in `.next/types/.../route.ts`). Keeping the pure helper here lets it
 * be imported by the route AND unit-tested directly.
 */

/**
 * When `parsedBody` carries a `registrationMetadata` object whose `userId`
 * differs from the verified `userId`, return the body re-serialized with
 * `registrationMetadata.userId` forced to `userId`. Returns null when there is
 * nothing to rewrite (no `registrationMetadata`, or it already matches) so the
 * caller keeps streaming the original body untouched.
 *
 * Tab OWNERSHIP is keyed on register/heartbeat by `registrationMetadata.userId`
 * (browser-supplied = `JWT.sub`) while the relay FILTERS on list by the
 * server-verified `X-Caller-User-Id` (the backend user id). For a Cognito
 * bearer / email-linked account those diverge, so forcing the body's userId to
 * the verified id keeps register + list aligned (and stops a client from
 * registering a tab under another user's id).
 */
export function registrationBodyWithCallerId(
  parsedBody: unknown,
  userId: string
): string | null {
  if (!parsedBody || typeof parsedBody !== "object") return null;
  const body = parsedBody as Record<string, unknown>;
  const rm = body.registrationMetadata;
  if (!rm || typeof rm !== "object") return null;
  const meta = rm as Record<string, unknown>;
  if (meta.userId === userId) return null;
  return JSON.stringify({
    ...body,
    registrationMetadata: { ...meta, userId },
  });
}

/**
 * The names under which the SDK relay reads a caller identity (per-user tab
 * scoping, §4.2), spelled exactly as it reads them. With the auth gate on,
 * the only identity the relay may act on is the verified one this route sends
 * as `X-Caller-User-Id`. So a request that names a caller itself, under
 * either name, has it removed before it is forwarded: from the query, from
 * the top level of a JSON body, and from the body's nested `request` object.
 * Only these exact names; nothing else is removed.
 */
export const CALLER_IDENTITY_KEYS: readonly string[] = [
  "__callerUserId",
  "callerUserId",
];

/**
 * `url` without any query parameter named as a caller identity — every
 * occurrence of a repeated key, matched on the decoded name — or null when it
 * carries none, so the caller keeps the original URL.
 */
export function urlWithoutCallerIdentity(url: string): string | null {
  const parsed = new URL(url);
  const present = CALLER_IDENTITY_KEYS.filter((key) =>
    parsed.searchParams.has(key)
  );
  if (present.length === 0) return null;
  for (const key of present) parsed.searchParams.delete(key);
  return parsed.toString();
}

/**
 * `parsedBody` without the caller identity in the places the SDK reads one:
 * top-level `__callerUserId` and `callerUserId`, and `__callerUserId` on the
 * nested `request` object. Returns null when the body is not a JSON object or
 * carries none of them, so the caller keeps streaming the original body.
 */
export function bodyWithoutCallerIdentity(
  parsedBody: unknown
): Record<string, unknown> | null {
  if (!isPlainObject(parsedBody)) return null;
  const top = CALLER_IDENTITY_KEYS.filter((key) =>
    Object.hasOwn(parsedBody, key)
  );
  const nested = parsedBody.request;
  const nestedHasKey =
    isPlainObject(nested) && Object.hasOwn(nested, "__callerUserId");
  if (top.length === 0 && !nestedHasKey) return null;
  const out: Record<string, unknown> = { ...parsedBody };
  for (const key of top) delete out[key];
  if (nestedHasKey) {
    const request: Record<string, unknown> = { ...nested };
    delete request.__callerUserId;
    out.request = request;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
