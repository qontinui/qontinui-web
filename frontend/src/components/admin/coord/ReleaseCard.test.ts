import { describe, it, expect } from "vitest";

import {
  releaseState,
  releaseDriftTone,
  releaseDriftLabel,
  type ReleaseBadgeTone,
} from "./ReleaseCard";
import type { ReleaseHistoryEntry } from "@/services/runner-releases-service";

/**
 * Anti-drift guard for the runner GitHub-Releases drift-state color/label
 * ladder on /admin/coord/releases. The contract (plan §3 drift-class mapping):
 *
 *   in_sync                 → green  "in sync"
 *   release:in_flight       → amber  "in flight"
 *   release:stale           → red    "stale"
 *   release:failed_deploy   → red    "stuck draft"   (the v1.0.0/v1.0.1 case)
 *   release:rolled_back     → red    "rolled back"
 *   unknown                 → grey   "unknown"
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
    expect(releaseDriftTone(dark)).toBe<ReleaseBadgeTone>("secondary");
    expect(releaseDriftLabel(dark)).toBe("unknown");
  });
});

describe("releaseDriftTone / releaseDriftLabel", () => {
  it("in_sync → green 'in sync'", () => {
    const e = entry({
      in_sync: true,
      drift_class: { token: "in_sync", canonical: "none", subclass: null },
    });
    expect(releaseDriftTone(e)).toBe<ReleaseBadgeTone>("success");
    expect(releaseDriftLabel(e)).toBe("in sync");
  });

  it("stuck draft (failed_deploy) → red 'stuck draft'", () => {
    const e = entry({
      drift_class: {
        token: "failed_deploy",
        canonical: "pending",
        subclass: "release:failed_deploy",
      },
    });
    expect(releaseDriftTone(e)).toBe<ReleaseBadgeTone>("destructive");
    expect(releaseDriftLabel(e)).toBe("stuck draft");
  });

  it("in_flight → amber 'in flight'", () => {
    const e = entry({
      drift_class: {
        token: "in_flight",
        canonical: "pending",
        subclass: "release:in_flight",
      },
    });
    expect(releaseDriftTone(e)).toBe<ReleaseBadgeTone>("warning");
    expect(releaseDriftLabel(e)).toBe("in flight");
  });

  it("rolled_back → red 'rolled back'", () => {
    const e = entry({
      drift_class: {
        token: "rolled_back",
        canonical: "active_negation",
        subclass: "release:rolled_back",
      },
    });
    expect(releaseDriftTone(e)).toBe<ReleaseBadgeTone>("destructive");
    expect(releaseDriftLabel(e)).toBe("rolled back");
  });

  it("unknown → grey 'unknown'", () => {
    const e = entry({
      drift_class: { token: "weird", canonical: "unknown", subclass: null },
    });
    expect(releaseDriftTone(e)).toBe<ReleaseBadgeTone>("secondary");
    expect(releaseDriftLabel(e)).toBe("unknown");
  });
});
