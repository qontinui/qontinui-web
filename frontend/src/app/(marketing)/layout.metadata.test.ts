import { describe, expect, it } from "vitest";
import { metadata } from "./layout";

describe("(marketing) layout metadata", () => {
  // Next merges the file-based cards beside this layout only when its own
  // `openGraph` / `twitter` declare no `images` key. An `images` entry here
  // would silently replace the generated card.
  it("leaves the card images to the file-based routes", () => {
    expect(metadata.openGraph).toBeDefined();
    expect(metadata.twitter).toBeDefined();
    expect(Object.hasOwn(metadata.openGraph ?? {}, "images")).toBe(false);
    expect(Object.hasOwn(metadata.twitter ?? {}, "images")).toBe(false);
  });

  it("asks X for the large-image card", () => {
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
