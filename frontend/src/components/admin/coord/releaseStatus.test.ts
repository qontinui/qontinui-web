import { describe, it, expect } from "vitest";

import { paletteDisagreements } from "@/components/console/attention";
import {
  RELEASE_ATTENTION_BY_STATE,
  RELEASE_AUTHOR_GLYPH_STATES,
  RELEASE_STATE_CLASS,
  deriveReleaseStatus,
  lagLabel,
  releaseDriftLabel,
  releaseIdentity,
  releaseState,
  type ReleaseState,
} from "./releaseStatus";
import type { ReleaseHistoryEntry } from "@/services/runner-releases-service";

/**
 * Anti-drift guard for the runner GitHub-Releases drift-state ladder on
 * /admin/coord/releases.
 *
 * PORTED from `ReleaseCard.test.ts` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2,
 * when the ladder moved out of the card into `releaseStatus.ts`. The
 * `releaseState` half is byte-equivalent — same entries, same expectations.
 * The colour half changed shape, because the surface stopped keying off
 * `BadgeVariant` names and started keying off an audited attention table:
 *
 *   in_sync                 → green  "in sync"     (attention: none)
 *   release:in_flight       → amber  "in flight"   (attention: waiting)
 *   release:stale           → red    "stale"       (attention: author)
 *   release:failed_deploy   → red    "stuck draft" (attention: author)
 *   release:rolled_back     → red    "rolled back" (attention: author)
 *   unknown                 → AMBER  "unknown"     (attention: waiting)
 *
 * Only the last line moved: `unknown` was grey. R3's ignorance floor says an
 * unreadable descriptor is amber, never calm — grey asserted "nothing is
 * waiting on you" about a row that means "we could not look". See
 * `releaseStatus.ts`'s module doc.
 *
 * Both the namespaced (`release:*`) and bare sub-class forms must resolve
 * identically, and `in_sync` must short-circuit regardless of the descriptor.
 */

const entry = (over: Partial<ReleaseHistoryEntry>): ReleaseHistoryEntry => ({
  observed_at: null,
  version: "v1.0.5",
  tag: "v1.0.5",
  repo: "qontinui/qontinui-runner",
  in_sync: false,
  drift_class: { token: "unknown", canonical: "unknown", subclass: null },
  lag_seconds: null,
  ci_state: null,
  published_tag: null,
  published_at: null,
  draft_present: false,
  prerelease: false,
  assets: [],
  has_setup_exe: false,
  has_latest_json: false,
  coverage: 1.0,
  credibility: 0.95,
  provenance: "github_releases",
  deploy_outcome_raw: null,
  ...over,
});

const ALL_STATES: ReleaseState[] = [
  "in_sync",
  "in_flight",
  "stale",
  "failed_deploy",
  "rolled_back",
  "unknown",
];

describe("releaseState", () => {
  it("short-circuits to in_sync when in_sync is true", () => {
    expect(
      releaseState(
        entry({
          in_sync: true,
          drift_class: { token: "in_sync", canonical: "none", subclass: null },
        })
      )
    ).toBe("in_sync");
  });

  it("resolves the namespaced release:* sub-class", () => {
    expect(
      releaseState(
        entry({
          drift_class: {
            token: "failed_deploy",
            canonical: "pending",
            subclass: "release:failed_deploy",
          },
        })
      )
    ).toBe("failed_deploy");
  });

  it("resolves a bare (un-namespaced) sub-class the same way", () => {
    expect(
      releaseState(
        entry({
          drift_class: {
            token: "in_flight",
            canonical: "pending",
            subclass: "in_flight",
          },
        })
      )
    ).toBe("in_flight");
  });

  it("falls back to the token when subclass is null", () => {
    expect(
      releaseState(
        entry({
          drift_class: { token: "stale", canonical: "pending", subclass: null },
        })
      )
    ).toBe("stale");
  });

  it("maps active_negation canonical to rolled_back", () => {
    expect(
      releaseState(
        entry({
          drift_class: {
            token: "rolled_back",
            canonical: "active_negation",
            subclass: "release:rolled_back",
          },
        })
      )
    ).toBe("rolled_back");
  });

  it("degrades to unknown on an unrecognized descriptor", () => {
    expect(
      releaseState(
        entry({
          drift_class: { token: "weird", canonical: "unknown", subclass: null },
        })
      )
    ).toBe("unknown");
  });

  it("classifies a DARK observation (null detail fields) as unknown", () => {
    // A dark github_releases row (GitHub unreachable / token unset) carries a
    // plain-text deploy_outcome → coord emits the five detail-derived fields as
    // null and coverage < 1. The state ladder must still resolve from
    // drift_class alone without touching the null detail fields.
    const dark = entry({
      drift_class: { token: "unknown", canonical: "unknown", subclass: null },
      coverage: 0,
      draft_present: null,
      prerelease: null,
      assets: null,
      has_setup_exe: null,
      has_latest_json: null,
    });
    expect(releaseState(dark)).toBe("unknown");
    expect(releaseDriftLabel(dark)).toBe("unknown");
    // Amber, not grey: we could not look, which is not the same as fine.
    expect(RELEASE_STATE_CLASS[releaseState(dark)]).toMatch(/bg-amber-/);
    // And a dark row must NOT report its unobserved assets as missing.
    expect(deriveReleaseStatus(dark).reason).toBeUndefined();
  });
});

describe("RELEASE_ATTENTION_BY_STATE — the R3 audit table", () => {
  it("is total over the state union, with a class for every state", () => {
    expect(Object.keys(RELEASE_ATTENTION_BY_STATE).sort()).toEqual(
      [...ALL_STATES].sort()
    );
    for (const s of ALL_STATES) {
      expect(RELEASE_STATE_CLASS[s], `${s} has no badge class`).toBeTruthy();
    }
  });

  it("agrees with the palette — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(RELEASE_ATTENTION_BY_STATE, {
        badgeClass: RELEASE_STATE_CLASS,
        authorGlyphKinds: RELEASE_AUTHOR_GLYPH_STATES,
      })
    ).toEqual([]);
  });

  it("pins the three states most likely to be re-filed wrongly", () => {
    // `paletteDisagreements` proves the hue matches the DECLARED attention and
    // can never prove the declared attention was right (§4.2 clause 4).
    //
    // Stuck draft is the state the whole surface exists to expose — the
    // v1.0.0/v1.0.1 case was found by hand, months late. Nothing clears it.
    expect(RELEASE_ATTENTION_BY_STATE.failed_deploy).toBe("author");
    // In flight names its clearer: the ~2h runner build, which settles on its
    // own. That is amber's contract, satisfied literally.
    expect(RELEASE_ATTENTION_BY_STATE.in_flight).toBe("waiting");
    // Published, assets present, nothing owed.
    expect(RELEASE_ATTENTION_BY_STATE.in_sync).toBe("none");
  });
});

describe("deriveReleaseStatus", () => {
  it("in_sync → green 'in sync'", () => {
    const e = entry({
      in_sync: true,
      drift_class: { token: "in_sync", canonical: "none", subclass: null },
    });
    const s = deriveReleaseStatus(e);
    expect(s.kind).toBe("in_sync");
    expect(s.label).toBe("in sync");
    expect(RELEASE_STATE_CLASS[s.kind]).toMatch(/bg-green-/);
  });

  it("stuck draft (failed_deploy) → red 'stuck draft'", () => {
    const e = entry({
      drift_class: {
        token: "failed_deploy",
        canonical: "pending",
        subclass: "release:failed_deploy",
      },
    });
    const s = deriveReleaseStatus(e);
    expect(s.label).toBe("stuck draft");
    expect(s.attention).toBe("author");
    expect(RELEASE_STATE_CLASS[s.kind]).toMatch(/bg-red-/);
  });

  it("in_flight → amber 'in flight'", () => {
    const e = entry({
      drift_class: {
        token: "in_flight",
        canonical: "pending",
        subclass: "release:in_flight",
      },
    });
    const s = deriveReleaseStatus(e);
    expect(s.label).toBe("in flight");
    expect(s.attention).toBe("waiting");
    expect(RELEASE_STATE_CLASS[s.kind]).toMatch(/bg-amber-/);
  });

  it("rolled_back → red 'rolled back'", () => {
    const e = entry({
      drift_class: {
        token: "rolled_back",
        canonical: "active_negation",
        subclass: "release:rolled_back",
      },
    });
    const s = deriveReleaseStatus(e);
    expect(s.label).toBe("rolled back");
    expect(RELEASE_STATE_CLASS[s.kind]).toMatch(/bg-red-/);
  });

  it("reports a lag before an asset gap, and an asset gap before CI", () => {
    expect(deriveReleaseStatus(entry({ lag_seconds: 7200 })).reason).toBe(
      "2h behind"
    );
    expect(
      deriveReleaseStatus(entry({ has_setup_exe: false, has_latest_json: true }))
        .reason
    ).toBe("no setup.exe");
    expect(
      deriveReleaseStatus(
        entry({ has_setup_exe: true, has_latest_json: true, ci_state: "failure" })
      ).reason
    ).toBe("CI failure");
  });

  it("never reports an UNOBSERVED asset as a missing one", () => {
    // `null` is a dark observation; `false` is a measurement. Conflating them
    // would report a missing installer on evidence we do not have.
    expect(
      deriveReleaseStatus(
        entry({ has_setup_exe: null, has_latest_json: null })
      ).reason
    ).toBeUndefined();
  });
});

describe("lagLabel / releaseIdentity", () => {
  it("formats a lag, and stays silent when there is none", () => {
    expect(lagLabel(90)).toBe("1m");
    expect(lagLabel(3600)).toBe("1h");
    expect(lagLabel(3900)).toBe("1h 5m");
    expect(lagLabel(0)).toBe("");
    expect(lagLabel(null)).toBe("");
    expect(lagLabel(Number.NaN)).toBe("");
  });

  it("identifies a release by tag, then version, then published tag", () => {
    expect(releaseIdentity(entry({ tag: "v2", version: "v1" }))).toBe("v2");
    expect(releaseIdentity(entry({ tag: null, version: "v1" }))).toBe("v1");
    expect(
      releaseIdentity(entry({ tag: null, version: null, published_tag: "v0" }))
    ).toBe("v0");
    expect(
      releaseIdentity(
        entry({ tag: null, version: null, published_tag: null })
      )
    ).toBe("—");
  });
});
