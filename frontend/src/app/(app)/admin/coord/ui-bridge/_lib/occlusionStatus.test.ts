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
  VISIBILITY_LOCAL_HIDES_TEXT,
  VISIBILITY_RELAYED_CLEAR_OBSERVED,
  VISIBILITY_RELAYED_CLEAR_UNOBSERVED,
  VISIBILITY_RELAYED_HIDES_TEXT,
} from "../__fixtures__/runnerBodies";
import {
  OCCLUSION_ATTENTION_BY_KIND,
  OCCLUSION_BADGE_CLASS,
  OCCLUSION_PALETTE,
  occlusionSummary,
  occlusionTextDisclosureText,
  readOcclusion,
  readOcclusionTextDisclosure,
} from "./occlusionStatus";

const data = (body: Record<string, unknown>) => body.data;

describe("readOcclusion — clear only when occlusion data was observed", () => {
  it("reads a clear sweep that OBSERVED occlusion data as clear", () => {
    const r = readOcclusion(data(VISIBILITY_RELAYED_CLEAR_OBSERVED));
    expect(r.kind).toBe("clear");
    expect(r.occlusions).toBe(0);
    expect(r.unknownReason).toBeNull();
  });

  it("reads a clear sweep with occlusionDataObserved: false as UNKNOWN, never clear", () => {
    const r = readOcclusion(data(VISIBILITY_RELAYED_CLEAR_UNOBSERVED));
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
    const r = readOcclusion(data(VISIBILITY_RELAYED_HIDES_TEXT));
    expect(r.kind).toBe("hides-text");
    expect(r.occlusions).toBe(2);
    expect(r.hidingText).toBe(1);
    expect(r.overlaysClassified).toBe(true);
  });

  it("reads the local shape — which names and quotes what it covers — to the same counts, carrying none of its text", () => {
    const r = readOcclusion(data(VISIBILITY_LOCAL_HIDES_TEXT));
    expect(r.kind).toBe("hides-text");
    expect(r.occlusions).toBe(2);
    expect(r.hidingText).toBe(1);
    expect(JSON.stringify(r)).not.toContain("Partner A");
    expect(JSON.stringify(r)).not.toContain("session-name");
    expect(JSON.stringify(r)).not.toContain("minimap");
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
    expect(
      occlusionSummary(readOcclusion(data(VISIBILITY_RELAYED_HIDES_TEXT)))
    ).toBe("2 occlusions across 47 elements, 1 hiding text.");
    expect(
      occlusionSummary(readOcclusion(data(VISIBILITY_RELAYED_CLEAR_OBSERVED)))
    ).toBe("Nothing covered across 47 elements, with occlusion data observed.");
    const unknown = occlusionSummary(
      readOcclusion(data(VISIBILITY_RELAYED_CLEAR_UNOBSERVED))
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

describe("readOcclusionTextDisclosure — only the runner's two words are answers", () => {
  it("reads a relayed report as withheld", () => {
    expect(
      readOcclusionTextDisclosure(data(VISIBILITY_RELAYED_HIDES_TEXT))
    ).toEqual({
      kind: "withheld",
    });
  });

  it("reads a local report as included", () => {
    expect(
      readOcclusionTextDisclosure(data(VISIBILITY_LOCAL_HIDES_TEXT))
    ).toEqual({
      kind: "included",
    });
  });

  it("reads an absent field as UNKNOWN, naming an older build", () => {
    expect(readOcclusionTextDisclosure({ verdict: "clear" })).toEqual({
      kind: "unknown",
      reason:
        "this runner's reply does not say (an older runner build does not)",
    });
    expect(readOcclusionTextDisclosure(undefined).kind).toBe("unknown");
  });

  it.each([["Withheld"], [true], [null], [0], ["maybe"]])(
    "reads %j as UNKNOWN — claiming neither answer",
    (said) => {
      expect(readOcclusionTextDisclosure({ occlusionText: said })).toEqual({
        kind: "unknown",
        reason: "this runner's reply gave an answer this page does not know",
      });
    }
  );

  it("is carried on every reading, the UNKNOWN ones included", () => {
    expect(
      readOcclusion(data(VISIBILITY_RELAYED_CLEAR_OBSERVED)).textDisclosure
    ).toEqual({ kind: "withheld" });
    expect(
      readOcclusion(data(VISIBILITY_RELAYED_CLEAR_UNOBSERVED)).textDisclosure
    ).toEqual({ kind: "withheld" });
    expect(readOcclusion(undefined).textDisclosure.kind).toBe("unknown");
  });
});

describe("occlusionTextDisclosureText", () => {
  it("says, for withheld, that which element is covered is not sent — and where it can be read", () => {
    const text = occlusionTextDisclosureText({ kind: "withheld" });
    expect(text).toMatch(/is not sent over the relay/);
    expect(text).toMatch(/A local UI Bridge read on the runner names them/);
  });

  it("says, for included, that the report names them and the page shows only counts", () => {
    expect(occlusionTextDisclosureText({ kind: "included" })).toMatch(
      /this page shows only the counts/
    );
  });

  it("says unknown, with its reason, for an UNKNOWN", () => {
    expect(
      occlusionTextDisclosureText({ kind: "unknown", reason: "because" })
    ).toBe(
      "Whether the sweep's report names the covered elements is unknown: because."
    );
  });
});
