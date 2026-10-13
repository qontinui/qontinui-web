import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/** An anonymous request, as a link-preview crawler sends it: no cookies. */
function anonymous(path: string) {
  return middleware(new NextRequest(`https://qontinui.io${path}`));
}

/**
 * Where Next serves the app's social cards: `app/` and `app/(marketing)/`
 * (`src/lib/public-routes.test.ts` derives these from the files on disk).
 */
const SOCIAL_CARD_ROUTES = [
  "/opengraph-image",
  "/twitter-image",
  "/opengraph-image-pwu6ef",
  "/twitter-image-pwu6ef",
];

describe("middleware — anonymous requests", () => {
  // One plain test, not `it.each`, so it can be named exactly: it is the
  // arming test for the card routes' public-route entry.
  it("lets an anonymous link-preview crawler fetch every social card", () => {
    for (const path of SOCIAL_CARD_ROUTES) {
      const res = anonymous(path);

      expect({ path, redirect: res.headers.get("location") }).toEqual({
        path,
        redirect: null,
      });
      expect({ path, next: res.headers.get("x-middleware-next") }).toEqual({
        path,
        next: "1",
      });
    }
  });

  it("still sends an anonymous request for a protected route to /login", () => {
    const res = anonymous("/build/workflows");

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });
});
