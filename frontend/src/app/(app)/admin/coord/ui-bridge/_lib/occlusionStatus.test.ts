/**
 * The occlusion-honesty rule (served policy `ux-priorities`
 * `the-runner-serves-the-occlusion-sweep-and-it-is-currently-vacuous`):
 * `verdict: "clear"` is a pass only with `occlusionDataObserved: true`. A
 * clear sweep that observed no occlusion data — or a build that does not say
 * whether it observed any — is UNKNOWN, never clear.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  VISIBILITY_CLEAR_OBSERVED,
  VISIBILITY_CLEAR_UNOBSERVED,
  VISIBILITY_HIDES_TEXT,
} from "../__fixtures__/runnerBodies";
import {
  OCCLUSION_ATTENTION_BY_KIND,
  OCCLUSION_BADGE_CLASS,
  OCCLUSION_PALETTE,
  occlusionSummary,
  readOcclusion,
} from "./occlusionStatus";

const data = (body: Record<string, unknown>) => body.data;

describe("readOcclusion — clear only when occlusion data was observed", () => {
  it("reads a clear sweep that OBSERVED occlusion data as clear", () => {
    const r = readOcclusion(data(VISIBILITY_CLEAR_OBSERVED));
    expect(r.kind).toBe("clear");
    expect(r.occlusions).toBe(0);
    expect(r.unknownReason).toBeNull();
  });

  it("reads a clear sweep with occlusionDataObserved: false as UNKNOWN, never clear", () => {
    const r = readOcclusion(data(VISIBILITY_CLEAR_UNOBSERVED));
    expect(r.kind).toBe("unknown");
    expect(r.kind).not.toBe("clear");
    expect(r.occlusions).toBeNull();
    expect(r.unknownReason).toMatch(/nothing was observed/);
  });

  it("reads a clear sweep that does not say whether it observed anything as UNKNOWN", () => {
    const r = readOcclusion({ verdict: "clear", elementCount: 10 });
    expect(r.kind).toBe("unknown");
    expect(r.unknownReason).toMatch(/does not say whether it observed/);
  });

  it("does not let a truthy non-boolean stand in for `true`", () => {
    for (const observed of ["true", 1, "yes", {}]) {
      expect(
        readOcclusion({ verdict: "clear", occlusionDataObserved: observed })
          .kind,
        String(observed)
      ).toBe("unknown");
    }
  });

  it("reads an empty registry as UNKNOWN", () => {
    expect(
      readOcclusion({ verdict: "unknown_empty_registry", elementCount: 0 }).kind
    ).toBe("unknown");
  });

  it("reads a verdict it does not know, or no report, as UNKNOWN", () => {
    expect(readOcclusion({ verdict: "all_good" }).kind).toBe("unknown");
    expect(readOcclusion(undefined).kind).toBe("unknown");
    expect(readOcclusion("clear").kind).toBe("unknown");
  });
});

describe("readOcclusion — findings", () => {
  it("counts occlusions and the ones hiding text, and calls hidden text out", () => {
    const r = readOcclusion(data(VISIBILITY_HIDES_TEXT));
    expect(r.kind).toBe("hides-text");
    expect(r.occlusions).toBe(2);
    expect(r.hidingText).toBe(1);
    expect(r.overlaysClassified).toBe(true);
  });

  it("reads occlusions that hide no text as overlaps", () => {
    const r = readOcclusion({
      verdict: "occlusions_found",
      occlusionDataObserved: true,
      occlusions: [{ element: "a", occludedBy: "b", hidesText: false }],
    });
    expect(r.kind).toBe("overlaps");
    expect(r.hidingText).toBe(0);
  });

  it("will not count a finding that lists no occlusion", () => {
    expect(
      readOcclusion({ verdict: "occlusions_found", occlusions: [] }).kind
    ).toBe("unknown");
  });

  it("says when modal overlays could not be told apart", () => {
    const r = readOcclusion({
      verdict: "clear",
      occlusionDataObserved: true,
      expectedOverlayDetection: "unavailable",
    });
    expect(r.overlaysClassified).toBe(false);
  });
});

describe("occlusionSummary", () => {
  it("states a real verdict with its scope, and an UNKNOWN as its reason", () => {
    expect(occlusionSummary(readOcclusion(data(VISIBILITY_HIDES_TEXT)))).toBe(
      "2 occlusions across 47 elements, 1 hiding text."
    );
    expect(
      occlusionSummary(readOcclusion(data(VISIBILITY_CLEAR_OBSERVED)))
    ).toBe("Nothing covered across 47 elements, with occlusion data observed.");
    const unknown = occlusionSummary(
      readOcclusion(data(VISIBILITY_CLEAR_UNOBSERVED))
    );
    expect(unknown).toMatch(/^The sweep found nothing covered/);
    expect(unknown).not.toMatch(/^Nothing covered/);
  });
});

describe("the occlusion palette (R3)", () => {
  it("agrees with its attention table", () => {
    expect(
      paletteDisagreements(OCCLUSION_ATTENTION_BY_KIND, OCCLUSION_PALETTE)
    ).toEqual([]);
  });

  it("is red only for hidden text and amber only for UNKNOWN", () => {
    expect(OCCLUSION_ATTENTION_BY_KIND).toEqual({
      clear: "none",
      "hides-text": "author",
      overlaps: "none",
      unknown: "waiting",
    });
    expect(OCCLUSION_BADGE_CLASS.unknown).toMatch(/\bbg-amber-/);
    expect(OCCLUSION_BADGE_CLASS.clear).not.toMatch(/\bbg-(red|amber)-/);
  });
});
