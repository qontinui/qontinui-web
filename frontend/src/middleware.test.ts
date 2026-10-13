import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/** An anonymous request, as a link-preview crawler sends it: no cookies. */
function anonymous(path: string) {
  return middleware(new NextRequest(`https://qontinui.io${path}`));
}

describe("middleware — anonymous requests", () => {
  it.each([
    "/opengraph-image",
    "/twitter-image",
    "/opengraph-image-pwu6ef",
    "/twitter-image-pwu6ef",
  ])("lets a crawler fetch the social card %s", (path) => {
    const res = anonymous(path);

    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("still sends an anonymous request for a protected route to /login", () => {
    const res = anonymous("/build/workflows");

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });
});
