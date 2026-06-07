/**
 * Canonical public-route classification.
 *
 * Shared by the auth-gating middleware (edge runtime) and the client
 * `AuthProvider`'s session-expiry handler so there is ONE source of truth for
 * "is this route reachable without authentication". Keep this module
 * framework-agnostic (no `next/server` imports) so both runtimes can import it.
 *
 * A public route is marketing, auth flow, API, or static. The middleware
 * allow-lists these (everything else is bounced to `/login`); the
 * session-expired handler uses the same predicate to decide whether an expiry
 * should hard-redirect to `/login` (protected routes) or simply drop local
 * auth state and stay put (public routes — an anonymous visitor's expected
 * 401, a mid-sign-in `/login`, or the in-page PKCE exchange on
 * `/auth/callback` must NOT be bounced).
 */

// Routes that anyone can reach without authentication.
export const PUBLIC_PATHS = [
  "/",
  "/login",
  "/privacy",
  "/privacy-extension",
  "/terms",
  "/acceptable-use",
  "/responsible-use",
  // Cognito hosted-UI OAuth landing. It arrives unauthenticated (no token/
  // marker cookie yet) carrying `?code=&state=`; it MUST run the PKCE token
  // exchange in-page rather than being bounced to `/login?next=…`. Exempting
  // it here is the provider-agnostic fix for all three social IdPs.
  "/auth/callback",
];

export const PUBLIC_PREFIXES = [
  "/docs",
  "/runner", // marketing /runner/download landing
  "/demo",
  "/api",
  "/coord-api",
  "/__ui-bridge__",
  "/setup-admin",
];

export function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
