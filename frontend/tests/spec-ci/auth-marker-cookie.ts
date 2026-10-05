/**
 * Seed the middleware's auth marker cookie into the browser CONTEXT, before
 * the first navigation.
 *
 * `middleware.ts` lets a protected route through only when the request carries
 * `qontinui_auth` (or the backend's `access_token` / `refresh_token`). The
 * smokes used to set that cookie from `page.addInitScript`, which runs inside
 * a document that already exists. So the FIRST navigation's HTTP request left
 * without it, the middleware redirected to `/login?next=…`, and the client
 * then bounced back to the route once it read the seeded sessionStorage.
 *
 * The transit always existed. The old fixed 2.5 s sample hid it, because the
 * client had already bounced back by then. Once `settleRoute` (`453c4eab9`)
 * began sampling right after `domcontentloaded`, it correctly reported the
 * `/login` it saw as a bounce. So the first route the smoke visited
 * (`/sessions` in the authed smoke) failed every time, and every smoked
 * production deploy from 2026-10-02 08:21Z was rolled back for it. The settle
 * poll is not the regression. Putting the cookie on the context makes the
 * first request carry it, the same as every later one.
 */

/** Must equal the name `middleware.ts` reads; `auth-marker-cookie.test.ts` checks it. */
export const AUTH_MARKER_COOKIE = "qontinui_auth";

/** The slice of Playwright's `BrowserContext` this needs (keeps it testable). */
export interface CookieContext {
  addCookies(
    cookies: Array<{
      name: string;
      value: string;
      url: string;
      sameSite: "Lax";
    }>
  ): Promise<void>;
}

export async function seedAuthMarkerCookie(
  context: CookieContext,
  baseUrl: string
): Promise<void> {
  await context.addCookies([
    {
      name: AUTH_MARKER_COOKIE,
      value: "1",
      // `url` lets Playwright derive domain, path and `Secure` from the origin.
      url: new URL(baseUrl).origin,
      sameSite: "Lax",
    },
  ]);
}
