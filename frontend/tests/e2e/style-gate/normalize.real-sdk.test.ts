/**
 * `deriveInteractable` over rows the INSTALLED `@qontinui/ui-bridge` produces.
 *
 * `normalize.test.ts` pins the rule against hand-written rows (the no-category
 * DOM-fallback rows among them: the SDK exports no public door to its scan);
 * this file builds the rows with the SDK itself — the registry's media,
 * content and interactive registrations serialized by `materializeElements`,
 * which is what the web's `/control/snapshot` serves the style gate — so an
 * SDK release that changes what those rows carry reaches the normalizer's
 * tests the day the dependency moves, not the day a style-gate capture
 * misreads a page.
 *
 * The motivating change (SDK 0.46, plan
 * 2026-11-09-an-elements-advertised-verbs-depend-on-which-path-found-it): a
 * media row's `actions` went from `[]` to the universal verb list, and the
 * normalizer read that list as registered handlers.
 */

import { afterEach, describe, expect, it } from "vitest";
import { UIBridgeRegistry } from "@qontinui/ui-bridge";
import { materializeElements } from "@qontinui/ui-bridge/server/handlers";
import { deriveInteractable } from "./normalize";
import capturedFind from "./fixtures/sdk-find-media-response.json";

/** A real media observation envelope (the captured SDK find row's). */
const MEDIA_OBSERVATION = (
  capturedFind as { elements: Array<{ mediaMetadata: unknown }> }
).elements[0].mediaMetadata;

function mount<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

/** Serialize one registry entry the way `/control/snapshot` does. */
function snapshotRow(registry: UIBridgeRegistry, id: string): Record<string, unknown> {
  const raw = registry.getAllElements().filter((el) => el.id === id);
  expect(raw).toHaveLength(1);
  return materializeElements(raw)[0] as unknown as Record<string, unknown>;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("deriveInteractable over the installed SDK's registry rows", () => {
  it("a registered image is a media row advertising verbs, and is NOT interactable", () => {
    const registry = new UIBridgeRegistry();
    const img = mount("img", { src: "/hero.png", alt: "Hero" });
    registry.registerMediaElement("img-hero", img, {
      mediaType: "image",
      // The registry stores the envelope; its shape is not what this test reads.
      mediaMetadata: MEDIA_OBSERVATION as never,
    });

    const row = snapshotRow(registry, "img-hero");
    expect(row.category).toBe("media");
    expect(row.type).toBe("image");
    // Positive control: this is the row shape the old rule misread — a media
    // row whose built-in verb list is not empty.
    expect(Array.isArray(row.actions) && row.actions.length > 0).toBe(true);
    expect(deriveInteractable(row)).toBe(false);
  });

  it("a registered canvas is NOT interactable although it advertises sendKeys", () => {
    const registry = new UIBridgeRegistry();
    const canvas = mount("canvas");
    registry.registerMediaElement("canvas-board", canvas, {
      mediaType: "canvas",
      mediaMetadata: MEDIA_OBSERVATION as never,
    });

    const row = snapshotRow(registry, "canvas-board");
    expect(row.category).toBe("media");
    expect(row.actions).toContain("sendKeys");
    expect(deriveInteractable(row)).toBe(false);
  });

  it("a registered content element is NOT interactable", () => {
    const registry = new UIBridgeRegistry();
    const heading = mount("h2");
    heading.textContent = "Overview";
    registry.registerContentElement("heading-overview", heading, {
      contentType: "heading",
      label: "Overview",
    });

    const row = snapshotRow(registry, "heading-overview");
    expect(row.category).toBe("content");
    expect(deriveInteractable(row)).toBe(false);
  });

  it("a registered button IS interactable (negative control for the media rows)", () => {
    const registry = new UIBridgeRegistry();
    const button = mount("button");
    button.textContent = "Save";
    registry.registerElement("button-save", button);

    const row = snapshotRow(registry, "button-save");
    expect(row.category).toBe("interactive");
    expect(deriveInteractable(row)).toBe(true);
  });
});
