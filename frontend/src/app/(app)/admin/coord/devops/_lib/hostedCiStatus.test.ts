import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  HOSTED_CI_ATTENTION_BY_KIND,
  HOSTED_CI_PALETTE,
  currentRepoChoice,
  hostedCiKind,
  isNotWatched,
  levelLabel,
  repoSourceLabel,
  repoStatus,
  summarizeRepos,
  tenantSourceLabel,
  type CiHostingRepoReading,
} from "./hostedCiStatus";

function reading(
  overrides: Partial<CiHostingRepoReading> = {}
): CiHostingRepoReading {
  return {
    repo: "o/r",
    level: "on",
    resolved_scope: "tenant",
    unknown_reason: null,
    ...overrides,
  };
}

describe("hostedCiStatus", () => {
  it("the palette agrees with the attention table (R3)", () => {
    expect(
      paletteDisagreements(HOSTED_CI_ATTENTION_BY_KIND, HOSTED_CI_PALETTE)
    ).toEqual([]);
  });

  it("off is a calm setting in effect, not an alarm", () => {
    expect(HOSTED_CI_ATTENTION_BY_KIND.off).toBe("none");
    expect(repoStatus(reading({ level: "off" })).attention).toBe("none");
  });

  it("a null level is UNKNOWN — a dash, never a guessed value", () => {
    const s = repoStatus(reading({ level: null, unknown_reason: "x" }));
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe("–");
    expect(s.attention).toBe("waiting");
  });

  it("a repo outside the tenant is UNKNOWN with its reason in words", () => {
    const r = reading({ level: null, unknown_reason: "repo_not_in_tenant" });
    expect(hostedCiKind(r)).toBe("unknown");
    expect(repoStatus(r).label).toBe("–");
    expect(repoStatus(r).reason).toMatch(/not one of this tenant's repos/);
  });

  it("there is no owners-disagree kind: coord never shows another tenant's preference", () => {
    expect(Object.keys(HOSTED_CI_ATTENTION_BY_KIND).sort()).toEqual([
      "off",
      "on",
      "unknown",
    ]);
  });

  it("not watched only for an explicit watched:false on an off repo", () => {
    expect(isNotWatched(reading({ level: "off", watched: false }))).toBe(true);
    expect(isNotWatched(reading({ level: "off", watched: null }))).toBe(false);
    expect(isNotWatched(reading({ level: "off" }))).toBe(false);
    expect(isNotWatched(reading({ level: "on", watched: false }))).toBe(false);
    const s = repoStatus(reading({ level: "off", watched: false }));
    expect(s.attention).toBe("waiting");
    expect(s.reason).toMatch(/not watched/);
  });

  it("levelLabel names both known levels", () => {
    expect(levelLabel("on")).toBe("On");
    expect(levelLabel("off")).toBe("Off");
  });

  it("a stale value is kept but no longer calm", () => {
    const s = repoStatus(reading({ level: "off" }), { stale: true });
    expect(s.label).toBe("Off");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toMatch(/stale/);
  });

  it("a failed read-back is UNKNOWN whatever the last read said", () => {
    const s = repoStatus(reading({ level: "on" }), { readbackError: "502" });
    expect(s.kind).toBe("unknown");
  });

  it("names the source in operator words", () => {
    expect(repoSourceLabel("repo")).toBe("repo override");
    expect(repoSourceLabel("tenant")).toBe("tenant");
    expect(repoSourceLabel("none")).toBe("default");
    expect(tenantSourceLabel("none")).toBe("default (on)");
    expect(tenantSourceLabel(null)).toBe("–");
  });

  it("the current repo choice is the override only on the repo band", () => {
    expect(
      currentRepoChoice(reading({ resolved_scope: "repo", level: "off" }))
    ).toBe("off");
    expect(currentRepoChoice(reading({ resolved_scope: "tenant" }))).toBe(
      "inherit"
    );
    expect(currentRepoChoice(reading({ level: null }))).toBeNull();
  });

  it("summarises repo counts with unknowns counted, not dropped", () => {
    expect(
      summarizeRepos([
        reading({ level: "on" }),
        reading({ level: "off" }),
        reading({ level: null }),
      ])
    ).toEqual({ on: 1, off: 1, unknown: 1 });
  });
});
