import { NextRequest, NextResponse } from "next/server";

/**
 * Auth-gating middleware.
 *
 * Redirects unauthenticated requests to protected routes to `/login`
 * (instead of falling through to the marketing landing page, which looks
 * like a broken link). Auth is detected via the HttpOnly `access_token`
 * or `refresh_token` cookies set by the backend; we treat presence of
 * either as "probably signed in". If the token is stale the page-level
 * `useAuth()` flow handles refresh / sign-out — middleware is a soft
 * gate, not a security boundary.
 *
 * Remote-backend mode: when the dashboard is pointed at a cross-origin
 * backend (`NEXT_PUBLIC_API_URL`), the backend's HttpOnly cookies never
 * land on this origin — the Bearer token lives in sessionStorage instead.
 * In that mode `TokenStorage` drops a client-readable `qontinui_auth`
 * marker cookie (no token, just "client believes it's signed in") so this
 * gate doesn't bounce a legitimately-authenticated session. Same soft-gate
 * caveat applies. Kept in sync with TokenStorage.AUTH_MARKER_COOKIE.
 *
 * Public routes (marketing, auth flows, API, static) are explicitly
 * allow-listed via the matcher below.
 */

// Routes that anyone can reach without authentication.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/privacy-extension",
];

const PUBLIC_PREFIXES = [
  "/docs",
  "/runner", // marketing /runner/download landing
  "/demo",
  "/api",
  "/coord-api",
  "/__ui-bridge__",
  "/setup-admin",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const hasAccessToken = request.cookies.get("access_token");
  const hasRefreshToken = request.cookies.get("refresh_token");
  // `qontinui_auth` is the remote-backend (Bearer/sessionStorage) marker —
  // see the module doc. Carries no token; soft gate only.
  const hasAuthMarker = request.cookies.get("qontinui_auth");
  if (hasAccessToken || hasRefreshToken || hasAuthMarker) {
    if (pathname === "/workflows") {
      const dest = request.nextUrl.clone();
      dest.pathname = "/build/workflows";
      return NextResponse.redirect(dest);
    }
    return NextResponse.next();
  }

  // Unauthenticated request to a protected route — send to /login with a
  // `next` parameter so the login page can bounce them back after sign-in.
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const nextTarget = `${pathname}${search}`;
  if (nextTarget && nextTarget !== "/login") {
    loginUrl.searchParams.set("next", nextTarget);
  }
  return NextResponse.redirect(loginUrl);
}

// Skip static assets, image optimization, and Next.js internals.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|sitemap.xml|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|json|js|css|map|woff|woff2|ttf|otf)$).*)",
  ],
};
