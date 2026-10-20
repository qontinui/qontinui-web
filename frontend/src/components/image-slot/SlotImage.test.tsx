import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ManifestRead } from "@/lib/image-slots/manifest";
import { SlotImage } from "./SlotImage";

// SlotImage reads the app's manifest at module scope; each test sets the one
// it renders against.
const state = vi.hoisted(() => ({
  manifest: null as ManifestRead | null,
  // What `useSearchParams` answers: the URL's query, or `null` (no router).
  params: new URLSearchParams() as URLSearchParams | null,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => state.params,
}));
vi.mock("@/lib/image-slots/manifest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/image-slots/manifest")>();
  return {
    ...actual,
    get SLOT_MANIFEST() {
      return state.manifest ?? actual.SLOT_MANIFEST;
    },
  };
});

const A = "a".repeat(64);
const B = "b".repeat(64);

beforeEach(() => {
  state.manifest = null;
  state.params = new URLSearchParams();
});

describe("<SlotImage> with no asset bound", () => {
  it("renders an explicitly marked placeholder the UI Bridge registers", () => {
    const { container } = render(
      <SlotImage slot="runs.active.idle" className="w-20" />
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("data-ui-bridge-image-slot")).toBe(
      "runs.active.idle"
    );
    expect(el.getAttribute("data-ui-bridge-placeholder")).toBe("true");
    expect(el.getAttribute("data-ui-bridge-placeholder-reason")).toBe(
      "no_asset"
    );
    expect(el.getAttribute("data-ui-bridge-id")).toBe(
      "image-slot.runs.active.idle"
    );
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("w-20");
  });

  it("reserves the spec's preferred aspect ratio", () => {
    const markup = renderToStaticMarkup(<SlotImage slot="runs.active.idle" />);
    expect(markup).toMatch(/^<div [^>]*style="aspect-ratio:1\/1"/);
  });

  it("draws a bordered box with an image glyph by default", () => {
    const { container } = render(<SlotImage slot="runs.active.idle" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("border-dashed");
    expect(el.querySelector("svg")).not.toBeNull();
  });

  it("shows the caller's placeholder content inside the reserved box instead", () => {
    const { container, getByTestId } = render(
      <SlotImage
        slot="runs.active.idle"
        placeholder={<span data-testid="motif" />}
      />
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-ui-bridge-placeholder")).toBe("true");
    expect(el.className).not.toContain("border-dashed");
    expect(el.contains(getByTestId("motif"))).toBe(true);
  });

  it("names the reason when the manifest is unreadable", () => {
    state.manifest = { ok: false, error: "x" };
    const { container } = render(<SlotImage slot="runs.active.idle" />);
    expect(
      container.firstElementChild?.getAttribute(
        "data-ui-bridge-placeholder-reason"
      )
    ).toBe("manifest_unreadable");
  });
});

describe("<SlotImage> with an asset bound", () => {
  beforeEach(() => {
    state.manifest = {
      ok: true,
      manifest: {
        generated_by: "qontinui-studio",
        slots: {
          "runs.active.idle": {
            files: {
              webp: "runs.active.idle.webp",
              png: "runs.active.idle.png",
            },
            sha256: { webp: A, png: B },
          },
        },
      },
    };
  });

  it("renders the chosen derivative, marked with its slot and no placeholder marker", () => {
    const { container } = render(
      <SlotImage slot="runs.active.idle" loading="eager" />
    );
    const picture = container.firstElementChild as HTMLElement;
    expect(picture.tagName).toBe("PICTURE");
    const source = picture.querySelector("source");
    expect(source?.getAttribute("type")).toBe("image/webp");
    expect(source?.getAttribute("srcset")).toBe(
      `/image-slots/runs.active.idle.webp?sha=${A}`
    );
    const img = picture.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      `/image-slots/runs.active.idle.png?sha=${B}`
    );
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("data-ui-bridge-image-slot")).toBe(
      "runs.active.idle"
    );
    expect(img.getAttribute("data-ui-bridge-id")).toBe(
      "image-slot.runs.active.idle"
    );
    expect(container.querySelector("[data-ui-bridge-placeholder]")).toBeNull();
  });

  it("keeps the reserved aspect ratio on the asset's box", () => {
    const markup = renderToStaticMarkup(<SlotImage slot="runs.active.idle" />);
    expect(markup).toMatch(/^<picture [^>]*style="aspect-ratio:1\/1"/);
  });

  describe("studio's D7 preview contract", () => {
    it("marks the <picture> and <img> with studio's media ids, slot id as-is", () => {
      const { container } = render(<SlotImage slot="runs.active.idle" />);
      const picture = container.firstElementChild as HTMLElement;
      expect(picture.getAttribute("data-media-id")).toBe(
        "studio-picture-runs.active.idle"
      );
      expect(picture.querySelector("img")?.getAttribute("data-media-id")).toBe(
        "studio-img-runs.active.idle"
      );
    });

    // The SERVER render: what the HTML says before any script runs, which
    // is when the browser decides whether to fetch.
    const ssrLoading = () =>
      /<img [^>]*loading="(eager|lazy)"/.exec(
        renderToStaticMarkup(<SlotImage slot="runs.active.idle" />)
      )?.[1];

    it("server-renders lazy on an ordinary page", () => {
      state.params = new URLSearchParams("other=1");
      expect(ssrLoading()).toBe("lazy");
    });

    it("server-renders eager on a preview load, whatever the caller asked for", () => {
      state.params = new URLSearchParams("studio_batch=b1&studio_attempt=2");
      expect(ssrLoading()).toBe("eager");
      const markup = renderToStaticMarkup(
        <SlotImage slot="runs.active.idle" loading="lazy" />
      );
      expect(markup).toContain('loading="eager"');
      expect(markup).not.toContain('loading="lazy"');
    });

    it("server-renders eager on a preview load whose batch value is empty", () => {
      state.params = new URLSearchParams("studio_batch=");
      expect(ssrLoading()).toBe("eager");
    });

    it("renders eager where the URL cannot be read (never lazy on an unknown page)", () => {
      state.params = null;
      expect(ssrLoading()).toBe("eager");
    });

    it("honours an explicit eager off a preview", () => {
      const { container } = render(
        <SlotImage slot="runs.active.idle" loading="eager" />
      );
      expect(container.querySelector("img")?.getAttribute("loading")).toBe(
        "eager"
      );
    });

    it("keeps every URL on the page's origin under /image-slots/ with the file's digest", () => {
      const { container } = render(<SlotImage slot="runs.active.idle" />);
      const urls = [
        container.querySelector("img")?.getAttribute("src"),
        ...Array.from(container.querySelectorAll("source")).map((s) =>
          s.getAttribute("srcset")
        ),
      ];
      expect(urls).toEqual([
        `/image-slots/runs.active.idle.png?sha=${B}`,
        `/image-slots/runs.active.idle.webp?sha=${A}`,
      ]);
    });
  });
});
