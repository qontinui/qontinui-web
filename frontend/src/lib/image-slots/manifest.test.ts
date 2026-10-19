import type { ImageSlotSpec } from "@qontinui/shared-types";
import { describe, expect, it } from "vitest";

import {
  SLOT_MANIFEST,
  readStudioManifest,
  resolveSlotImage,
  type ManifestRead,
  type StudioSlotEntry,
} from "./manifest";
import { imageSlotSpec } from "./specs.generated";

const SPEC = imageSlotSpec("runs.active.idle");
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function manifestWith(entry: StudioSlotEntry): ManifestRead {
  return {
    ok: true,
    manifest: {
      generated_by: "qontinui-studio",
      slots: { "runs.active.idle": entry },
    },
  };
}

describe("the app's studio-manifest.json", () => {
  it("reads", () => {
    expect(SLOT_MANIFEST).toEqual({
      ok: true,
      manifest: { generated_by: "qontinui-studio", slots: {} },
    });
  });
});

describe("readStudioManifest", () => {
  it.each([
    [null, "the manifest is not a JSON object"],
    [[], "the manifest is not a JSON object"],
    [{ slots: {} }, "`generated_by` is not a string"],
    [{ generated_by: "x", slots: [] }, "`slots` is not an object"],
    [
      { generated_by: "x", slots: { s: { files: { png: "s.png" } } } },
      "slots.s lacks string maps `files` and `sha256`",
    ],
    [
      { generated_by: "x", slots: { s: { files: { png: 1 }, sha256: {} } } },
      "slots.s lacks string maps `files` and `sha256`",
    ],
  ])("refuses %j", (raw, error) => {
    expect(readStudioManifest(raw)).toEqual({ ok: false, error });
  });

  it("keeps studio's other fields", () => {
    const raw = {
      generated_by: "qontinui-studio",
      slots: {
        s: { files: {}, sha256: {}, ai_generated: true, batch_id: "b1" },
      },
    };
    expect(readStudioManifest(raw)).toEqual({ ok: true, manifest: raw });
  });
});

describe("resolveSlotImage", () => {
  it("renders the placeholder while the manifest is unreadable", () => {
    expect(
      resolveSlotImage("runs.active.idle", SPEC, { ok: false, error: "x" })
    ).toEqual({
      kind: "placeholder",
      reason: "manifest_unreadable",
    });
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "does not resolve a slot named %s to an inherited property",
    (slot) => {
      expect(resolveSlotImage(slot, { ...SPEC, slot }, SLOT_MANIFEST)).toEqual({
        kind: "placeholder",
        reason: "no_asset",
      });
    }
  );

  it("renders the placeholder while no asset is bound", () => {
    expect(resolveSlotImage("runs.active.idle", SPEC, SLOT_MANIFEST)).toEqual({
      kind: "placeholder",
      reason: "no_asset",
    });
  });

  it.each<[string, StudioSlotEntry]>([
    ["an unknown format", { files: { gif: "s.gif" }, sha256: { gif: A } }],
    [
      "the extension instead of studio's format key",
      { files: { jpg: "s.jpg" }, sha256: { jpg: A } },
    ],
    [
      "a path for a file name",
      { files: { png: "../s.png" }, sha256: { png: A } },
    ],
    ["a file without its digest", { files: { png: "s.png" }, sha256: {} }],
    ["a malformed digest", { files: { png: "s.png" }, sha256: { png: "ABC" } }],
  ])("renders the placeholder for an entry naming %s", (_, entry) => {
    expect(
      resolveSlotImage("runs.active.idle", SPEC, manifestWith(entry))
    ).toEqual({
      kind: "placeholder",
      reason: "asset_unusable",
    });
  });

  it("serves the most widely decodable format as <img src>, the others as <source>s, most efficient first", () => {
    const entry = {
      files: { avif: "s.avif", webp: "s.webp", png: "s.png" },
      sha256: { avif: A, webp: B, png: C },
    };
    expect(
      resolveSlotImage("runs.active.idle", SPEC, manifestWith(entry))
    ).toEqual({
      kind: "asset",
      sources: [
        { type: "image/avif", srcSet: `/image-slots/s.avif?sha=${A}` },
        { type: "image/webp", srcSet: `/image-slots/s.webp?sha=${B}` },
      ],
      src: `/image-slots/s.png?sha=${C}`,
      alt: "",
    });
  });

  it("falls back to webp when no png or jpg is published", () => {
    const entry = {
      files: { avif: "s.avif", webp: "s.webp" },
      sha256: { avif: A, webp: B },
    };
    const resolved = resolveSlotImage(
      "runs.active.idle",
      SPEC,
      manifestWith(entry)
    );
    expect(resolved).toMatchObject({
      kind: "asset",
      src: `/image-slots/s.webp?sha=${B}`,
      sources: [{ type: "image/avif", srcSet: `/image-slots/s.avif?sha=${A}` }],
    });
  });

  it("encodes the file name into the URL", () => {
    const entry = { files: { png: "a b#.png" }, sha256: { png: A } };
    expect(
      resolveSlotImage("runs.active.idle", SPEC, manifestWith(entry))
    ).toMatchObject({
      src: `/image-slots/a%20b%23.png?sha=${A}`,
    });
  });

  describe("alt text", () => {
    const entry = { files: { png: "s.png" }, sha256: { png: A } };
    const withAlt = (
      alt: ImageSlotSpec["alt"],
      altText?: string
    ): ImageSlotSpec => ({
      ...SPEC,
      alt,
      provenance:
        altText === undefined
          ? undefined
          : {
              asset_sha256: A,
              spec_sha256: B,
              source: "authored",
              ai_generated: false,
              alt_text: altText,
            },
    });

    it("is empty for a decorative slot", () => {
      expect(
        resolveSlotImage(
          "runs.active.idle",
          withAlt({ kind: "decorative" }),
          manifestWith(entry)
        )
      ).toMatchObject({ kind: "asset", alt: "" });
    });

    it("is the spec's text for a `text` slot", () => {
      expect(
        resolveSlotImage(
          "runs.active.idle",
          withAlt({ kind: "text", text: "An idle pipeline" }),
          manifestWith(entry)
        )
      ).toMatchObject({ kind: "asset", alt: "An idle pipeline" });
    });

    it("is the binding's alt_text for a `required` slot", () => {
      expect(
        resolveSlotImage(
          "runs.active.idle",
          withAlt({ kind: "required" }, "A resting pipeline"),
          manifestWith(entry)
        )
      ).toMatchObject({ kind: "asset", alt: "A resting pipeline" });
    });

    it("withholds an asset whose required alt_text is missing", () => {
      expect(
        resolveSlotImage(
          "runs.active.idle",
          withAlt({ kind: "required" }),
          manifestWith(entry)
        )
      ).toEqual({ kind: "placeholder", reason: "alt_text_missing" });
    });
  });
});

describe("a lucide entry", () => {
  const LUCIDE = {
    route: "lucide",
    files: {},
    sha256: {},
    lucide: {
      package: "lucide-react",
      icon: "circle-user",
      component: "CircleUser",
    },
    binding: { source: "selected", ai_generated: false },
  };

  it("is read", () => {
    const raw = {
      generated_by: "qontinui-studio",
      slots: { "runs.active.idle": LUCIDE },
    };
    expect(readStudioManifest(raw)).toEqual({ ok: true, manifest: raw });
  });

  it.each([
    ["no lucide object", { ...LUCIDE, lucide: undefined }],
    [
      "another package",
      { ...LUCIDE, lucide: { ...LUCIDE.lucide, package: "react-icons" } },
    ],
    [
      "a component that is not an export name",
      { ...LUCIDE, lucide: { ...LUCIDE.lucide, component: "circle-user" } },
    ],
    [
      "an icon that is not a lucide name",
      { ...LUCIDE, lucide: { ...LUCIDE.lucide, icon: "CircleUser" } },
    ],
  ])("is refused with %s", (_, entry) => {
    expect(
      readStudioManifest({ generated_by: "x", slots: { s: entry } })
    ).toMatchObject({ ok: false });
  });

  const manifestOf = (entry: StudioSlotEntry): ManifestRead =>
    manifestWith(entry);
  const entry = LUCIDE as unknown as StudioSlotEntry;

  it("renders the component the registry holds, decorative", () => {
    expect(
      resolveSlotImage(
        "runs.active.idle",
        SPEC,
        manifestOf(entry),
        undefined,
        new Set(["CircleUser"])
      )
    ).toEqual({ kind: "lucide", component: "CircleUser", alt: "" });
  });

  it("renders the placeholder for a component the registry does not hold", () => {
    expect(
      resolveSlotImage(
        "runs.active.idle",
        SPEC,
        manifestOf(entry),
        undefined,
        new Set(["Inbox"])
      )
    ).toEqual({ kind: "placeholder", reason: "lucide_unavailable" });
  });

  it("takes a required slot's alt text from the binding", () => {
    const required: ImageSlotSpec = { ...SPEC, alt: { kind: "required" } };
    const withAlt = {
      ...LUCIDE,
      binding: { ...LUCIDE.binding, alt_text: "Your account" },
    } as unknown as StudioSlotEntry;
    expect(
      resolveSlotImage(
        "runs.active.idle",
        required,
        manifestOf(withAlt),
        undefined,
        new Set(["CircleUser"])
      )
    ).toEqual({ kind: "lucide", component: "CircleUser", alt: "Your account" });
    expect(
      resolveSlotImage(
        "runs.active.idle",
        required,
        manifestOf(entry),
        undefined,
        new Set(["CircleUser"])
      )
    ).toEqual({ kind: "placeholder", reason: "alt_text_missing" });
  });
});
