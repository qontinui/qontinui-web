import { describe, expect, it } from "vitest";

import { sameOriginNext } from "./safe-next";

const ORIGIN = "https://qontinui.io";

describe("sameOriginNext", () => {
  it.each([
    ["/admin/coord", "/admin/coord"],
    ["/co-pilot?tab=runs#latest", "/co-pilot?tab=runs#latest"],
    ["/proyectos/café/正在", "/proyectos/caf%C3%A9/%E6%AD%A3%E5%9C%A8"],
    ["/a/./b/../c", "/a/c"],
    ["/", "/"],
  ])("accepts the same-origin path %s, resolved", (raw, expected) => {
    expect(sameOriginNext(raw, ORIGIN)).toBe(expected);
  });

  it.each([null, undefined, ""])("refuses an absent value (%s)", (raw) => {
    expect(sameOriginNext(raw, ORIGIN)).toBeNull();
  });

  it("refuses an absolute URL to another origin", () => {
    expect(sameOriginNext("https://elsewhere.example/x", ORIGIN)).toBeNull();
  });

  it("refuses a protocol-relative reference", () => {
    expect(sameOriginNext("//elsewhere.example/x", ORIGIN)).toBeNull();
  });

  it("refuses backslash spellings the URL parser reads as another host", () => {
    for (const raw of [
      "/\\elsewhere.example",
      "/\\/elsewhere.example",
      "\\\\elsewhere.example",
    ]) {
      expect(sameOriginNext(raw, ORIGIN)).toBeNull();
    }
  });

  it("refuses a reference that becomes protocol-relative once tabs or newlines are stripped", () => {
    for (const raw of [
      "/\t/elsewhere.example",
      "/\n/elsewhere.example",
      "/\r/elsewhere.example",
    ]) {
      expect(sameOriginNext(raw, ORIGIN)).toBeNull();
    }
  });

  it("refuses a dot segment that resolves to a path with two leading slashes", () => {
    for (const raw of [
      "/.//elsewhere.example",
      "/././/elsewhere.example",
      "/a/..//elsewhere.example",
    ]) {
      expect(sameOriginNext(raw, ORIGIN)).toBeNull();
    }
  });

  it("refuses the same through a percent-encoded dot segment", () => {
    for (const raw of [
      "/%2e//elsewhere.example",
      "/%2E//elsewhere.example",
      "/a/%2e%2e//elsewhere.example",
    ]) {
      expect(sameOriginNext(raw, ORIGIN)).toBeNull();
    }
  });

  it("refuses a value that is not a path", () => {
    for (const raw of [
      "elsewhere.example",
      "javascript:void(0)",
      "data:text/html,x",
    ]) {
      expect(sameOriginNext(raw, ORIGIN)).toBeNull();
    }
  });

  it("uses the page's own origin by default", () => {
    expect(sameOriginNext("/admin/coord")).toBe("/admin/coord");
    expect(sameOriginNext("//elsewhere.example")).toBeNull();
  });
});
