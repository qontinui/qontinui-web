/**
 * memoryStatus — the `/admin/coord/memory` status derivation and its R3 audit.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 2. Modelled on `planStatus.test.ts`: pure, no DOM, and the palette
 * agreement asserted through the SHARED `paletteDisagreements` rather than a
 * private copy of it (style guide §4.2 clause 3).
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  MEMORY_ATTENTION_BY_TONE,
  MEMORY_AUTHOR_GLYPH_TONES,
  MEMORY_STATUS_PALETTE,
  MEMORY_TONE_CLASS,
  deriveMemoryStatus,
  memoryIdentity,
  type MemoryStatusTone,
} from "./memoryStatus";

const ALL_TONES: MemoryStatusTone[] = ["known", "unknown"];

describe("MEMORY_ATTENTION_BY_TONE — the R3 audit table", () => {
  it("is total over the tone union, with no extra entries", () => {
    expect(Object.keys(MEMORY_ATTENTION_BY_TONE).sort()).toEqual(
      [...ALL_TONES].sort()
    );
    for (const tone of ALL_TONES) {
      expect(MEMORY_TONE_CLASS[tone], `${tone} has no badge class`).toBeTruthy();
    }
  });

  it("agrees with the palette — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(MEMORY_ATTENTION_BY_TONE, {
        badgeClass: MEMORY_TONE_CLASS,
        authorGlyphKinds: MEMORY_AUTHOR_GLYPH_TONES,
      })
    ).toEqual([]);
  });

  it("paints NOTHING red — a memory asks nothing of anybody", () => {
    // The point of the audit table is that this is a stated decision, not an
    // accident of which classes happened to be pasted in. Nothing about a
    // memory decays, nothing clears, nothing is blocked; a red badge nobody
    // must act on is exactly what R3 exists to prevent.
    for (const tone of ALL_TONES) {
      expect(MEMORY_TONE_CLASS[tone], `${tone} is red`).not.toMatch(/bg-red-/);
    }
    expect(MEMORY_AUTHOR_GLYPH_TONES.size).toBe(0);
    expect(MEMORY_STATUS_PALETTE.badgeClass).toBe(MEMORY_TONE_CLASS);
  });
});

describe("deriveMemoryStatus", () => {
  it("renders a known kind calm, labelled with the kind verbatim", () => {
    const s = deriveMemoryStatus({ type: "reference" });
    expect(s.kind).toBe("known");
    expect(s.label).toBe("reference");
    expect(s.attention).toBe("none");
    expect(s.reason).toBeUndefined();
  });

  it("accepts the legacy frontmatter kinds still present in the corpus", () => {
    for (const legacy of ["project", "proj", "ref", "user"]) {
      expect(deriveMemoryStatus({ type: legacy }).kind, legacy).toBe("known");
    }
  });

  it("shows an unrecognised kind VERBATIM and floors it at amber, not calm", () => {
    const s = deriveMemoryStatus({ type: "brand_new_kind_2027" });
    expect(s.kind).toBe("unknown");
    // Never rewritten, never dropped — the raw value is what is displayed.
    expect(s.label).toBe("brand_new_kind_2027");
    // R3's ignorance floor. Calm here would assert "nothing is odd about this
    // row", which is precisely what we do not know.
    expect(s.attention).toBe("waiting");
    expect(MEMORY_TONE_CLASS[s.kind]).toMatch(/bg-amber-/);
  });

  it("treats an absent kind as unknown, not as a default kind", () => {
    for (const type of [undefined, null, "", "   "]) {
      const s = deriveMemoryStatus({ type });
      expect(s.kind, JSON.stringify(type)).toBe("unknown");
      expect(s.label).toBe("no type");
      expect(s.attention).toBe("waiting");
    }
  });

  it("matches a known kind case-insensitively but still displays its case", () => {
    const s = deriveMemoryStatus({ type: "Reference" });
    expect(s.kind).toBe("known");
    expect(s.label).toBe("Reference");
  });
});

describe("memoryIdentity", () => {
  it("renders the version head", () => {
    expect(memoryIdentity({ version: 14 })).toBe("v14");
    expect(memoryIdentity({ version: 0 })).toBe("v0");
  });

  it("says the version is unknown rather than fabricating v0", () => {
    expect(
      memoryIdentity({ version: undefined as unknown as number })
    ).toBe("v?");
    expect(memoryIdentity({ version: null as unknown as number })).toBe("v?");
  });
});
