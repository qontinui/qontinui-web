import { describe, expect, it } from "vitest";
import { isLocalImageSrc } from "./MarkdownView";

describe("isLocalImageSrc", () => {
  it("loads same-origin images only", () => {
    expect(isLocalImageSrc("/uploads/diagram.png")).toBe(true);
    expect(isLocalImageSrc("diagram.png")).toBe(true);
  });

  it("refuses anything that would reach another host", () => {
    expect(isLocalImageSrc("https://tracker.example/p.gif")).toBe(false);
    expect(isLocalImageSrc("//tracker.example/p.gif")).toBe(false);
    expect(isLocalImageSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isLocalImageSrc(undefined)).toBe(false);
  });
});
