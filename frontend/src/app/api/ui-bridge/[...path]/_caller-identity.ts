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
