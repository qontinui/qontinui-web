/**
 * R3's audit for the memory-federation palette, plus the judgement
 * `paletteDisagreements` cannot make (style guide §4.2 clause 4: it proves the
 * hue matches the DECLARED attention, never that the declared attention was
 * right).
 *
 * The judgement here is that a report with failures is RED and not amber. The
 * two-part amber test decides it: we can name no process that clears the row
 * (the run is finished; nothing retries a failed name), and we do know the
 * row's state (three integers on a receipt). Both halves hold, so amber is
 * wrong.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  deriveFederationStatus,
  FEDERATION_ATTENTION_BY_KIND,
  FEDERATION_AUTHOR_GLYPH_KINDS,
  FEDERATION_KIND_CLASS,
  type FederationReportKind,
} from "./federationStatus";

const ALL: FederationReportKind[] = ["synced", "partial", "idle"];

describe("federation report palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(FEDERATION_ATTENTION_BY_KIND, {
        badgeClass: FEDERATION_KIND_CLASS,
        authorGlyphKinds: FEDERATION_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    expect(Object.keys(FEDERATION_ATTENTION_BY_KIND).sort()).toEqual(
      [...ALL].sort()
    );
    for (const k of ALL) expect(FEDERATION_KIND_CLASS[k]).toBeTruthy();
  });

  it("mints no amber at all — nothing on this surface self-clears", () => {
    for (const k of ALL) {
      expect(/\bbg-amber-/.test(FEDERATION_KIND_CLASS[k])).toBe(false);
    }
  });
});

describe("the failure-first precedence the palette audit cannot make", () => {
  it("files any failure as author-action, even beside a big success", () => {
    const s = deriveFederationStatus({ pushed: 40, pulled: 3, failed: 1 });
    expect(s.kind).toBe("partial");
    expect(s.attention).toBe("author");
    // Singular/plural, because the reason is read by a human.
    expect(s.reason).toMatch(/1 memory did not federate/);
    expect(/\bbg-red-/.test(FEDERATION_KIND_CLASS.partial)).toBe(true);
  });

  it("calls a clean run synced and owes it no explanation", () => {
    const s = deriveFederationStatus({ pushed: 2, pulled: 0, failed: 0 });
    expect(s.kind).toBe("synced");
    expect(s.attention).toBe("none");
    expect(s.reason).toBeUndefined();
  });

  it("treats an all-zero run as idle, not as a failure or a success", () => {
    const s = deriveFederationStatus({ pushed: 0, pulled: 0, failed: 0 });
    expect(s.kind).toBe("idle");
    expect(s.attention).toBe("none");
    // R3's third case: nothing is owed, and the row says why in words.
    expect(s.reason).toMatch(/no new memories/);
  });

  it("reads absent counts as zero rather than inventing a failure", () => {
    const s = deriveFederationStatus({});
    expect(s.kind).toBe("idle");
    expect(deriveFederationStatus({ failed: null, pushed: 1 }).kind).toBe(
      "synced"
    );
  });
});
