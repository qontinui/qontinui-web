import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { FORMATS } from "@/lib/image-slots/manifest";
import { config, middleware } from "./middleware";

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

  it("keeps a lookalike of a card route gated", () => {
    // `-xg4ifa` is the suffix an `(app)` group card would be served at;
    // `opengraph-image2` is a numbered card no tree serves.
    for (const path of [
      "/opengraph-image2",
      "/opengraph-image-xg4ifa",
      "/twitter-image9-zzzzzz",
    ]) {
      const res = anonymous(path);

      expect({ path, status: res.status }).toEqual({ path, status: 307 });
      expect(new URL(res.headers.get("location") ?? "").pathname).toBe(
        "/login"
      );
    }
  });
});

describe("middleware — a qontinui-studio preview load", () => {
  // Studio's D7 gate (plan 2026-10-13-image-generation-and-visual-judgment,
  // Phase 19) loads a page with these two params and reads them back; the
  // page must keep them on every path the middleware takes.
  const PREVIEW = "/runs/active?studio_batch=b-20261019&studio_attempt=2";

  it("passes an authenticated preview through with its query intact", () => {
    const req = new NextRequest(`https://qontinui.io${PREVIEW}`);
    req.cookies.set("access_token", "x");
    const res = middleware(req);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("carries both params through the login bounce", () => {
    const res = anonymous(PREVIEW);
    const next = new URL(res.headers.get("location") ?? "").searchParams.get(
      "next"
    );
    expect(next).toBe(PREVIEW);
  });
});

describe("middleware — image-slot files", () => {
  // Every format studio publishes, by the extension it writes. A gated one
  // breaks <picture> for every logged-out visitor: the browser takes the
  // first <source> whose type it supports, follows the redirect, and does
  // not fall back to the next source.
  const EXTENSIONS = FORMATS.map(([, , extension]) => extension);

  it("covers every format the slot reader serves", () => {
    expect([...EXTENSIONS].sort()).toEqual([
      "avif",
      "jpg",
      "png",
      "svg",
      "webp",
    ]);
  });

  it.each(EXTENSIONS)(
    "lets an anonymous request for a .%s slot file through",
    (ext) => {
      const res = anonymous(
        `/image-slots/runs.active.idle.${ext}?sha=${"a".repeat(64)}`
      );
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  );

  it.each(EXTENSIONS)(
    "keeps .%s files out of the middleware altogether",
    (ext) => {
      const matcher = new RegExp(`^${config.matcher[0]}$`);
      expect(matcher.test(`/image-slots/x.${ext}`)).toBe(false);
      expect(matcher.test("/runs/active")).toBe(true);
    }
  );
});
