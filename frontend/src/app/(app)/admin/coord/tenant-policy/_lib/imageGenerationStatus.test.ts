/**
 * imageGenerationStatus — the derivations the image generation panel renders
 * from (plan `2026-10-13-image-generation-and-visual-judgment` Phase 12).
 *
 * The property this file exists for: no reading the console cannot vouch for
 * renders as a level. A coord that predates the domain answers "no row, `off`";
 * that must read UNKNOWN — never `on` (the domain's default), and never `off`
 * (somebody's choice).
 */

import { describe, expect, it } from "vitest";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import {
  IMAGE_GENERATION_ATTENTION_BY_KIND,
  UNKNOWN_DASH,
  findOverride,
  knownLevel,
  overrideStatus,
  readRepoOverrides,
  readTenantImageGeneration,
  type ImageGenerationOverride,
} from "./imageGenerationStatus";
import { isOwnerName, parseImageGenerationLevel } from "../types";

function view(overrides: Partial<FleetPolicyView> = {}): FleetPolicyView {
  return {
    domain: "image_generation",
    effective_level: "on",
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    ...overrides,
  };
}

const override = (
  repo: string,
  level: ImageGenerationOverride["level"],
  raw: string = level ?? "?"
): ImageGenerationOverride => ({ repo, level, raw });

describe("parseImageGenerationLevel", () => {
  it("accepts the three levels exactly", () => {
    expect(parseImageGenerationLevel("on")).toBe("on");
    expect(parseImageGenerationLevel("local_only")).toBe("local_only");
    expect(parseImageGenerationLevel("off")).toBe("off");
  });

  it("returns null — UNKNOWN — for anything else, near misses included", () => {
    for (const raw of [
      "local-only",
      "LOCAL_ONLY",
      " on",
      "On",
      "inherit",
      "",
      null,
      undefined,
    ]) {
      expect(parseImageGenerationLevel(raw)).toBeNull();
    }
  });
});

describe("isOwnerName", () => {
  it("accepts owner/name", () => {
    expect(isOwnerName("qontinui/qontinui-web")).toBe(true);
    expect(isOwnerName("a/b")).toBe(true);
  });

  it("refuses every shape coord refuses", () => {
    for (const key of [
      "",
      "qontinui-web",
      "/name",
      "owner/",
      "a/b/c",
      " a/b",
      "a/b ",
      "a /b",
      "a/b\n",
    ]) {
      expect(isOwnerName(key)).toBe(false);
    }
  });
});

describe("readTenantImageGeneration", () => {
  it("reads no row + `on` as the declared default, and says it is a default", () => {
    expect(readTenantImageGeneration(view({ resolved_scope: "none" }))).toEqual(
      { state: "known", level: "on", defaulted: true }
    );
  });

  it("reads no row + any other level as UNKNOWN — never `on`, never `off`", () => {
    // What a coord that predates the domain answers, and what the backend
    // floors an answer with no level to.
    const r = readTenantImageGeneration(
      view({
        resolved_scope: "none",
        effective_level: "off",
        master_enabled: false,
      })
    );
    expect(r).toEqual({ state: "no_declared_default", raw: "off" });
    expect(knownLevel(r)).toBeNull();

    expect(
      readTenantImageGeneration(
        view({ resolved_scope: " none\n", effective_level: "local_only" })
      )
    ).toEqual({ state: "no_declared_default", raw: "local_only" });
  });

  it("reads a tenant or system row as its level", () => {
    for (const level of ["on", "local_only", "off"] as const) {
      for (const scope of ["tenant", "system"]) {
        const r = readTenantImageGeneration(
          view({ effective_level: level, resolved_scope: scope })
        );
        expect(r).toEqual({ state: "known", level, defaulted: false });
        expect(knownLevel(r)).toBe(level);
      }
    }
  });

  it("reads an unrecognised level as UNKNOWN and keeps the raw spelling", () => {
    const r = readTenantImageGeneration(view({ effective_level: "maybe" }));
    expect(r).toEqual({ state: "unrecognised", raw: "maybe" });
    expect(knownLevel(r)).toBeNull();
  });
});

describe("readRepoOverrides", () => {
  it("is UNKNOWN (null) without a read, or when the read carried no list", () => {
    expect(readRepoOverrides(null)).toBeNull();
    expect(readRepoOverrides(view())).toBeNull();
    expect(readRepoOverrides(view({ repo_overrides: null }))).toBeNull();
  });

  it("an empty list is no overrides", () => {
    expect(readRepoOverrides(view({ repo_overrides: [] }))).toEqual([]);
  });

  it("maps each override to what a reader of that repo resolves", () => {
    expect(
      readRepoOverrides(
        view({
          repo_overrides: [
            {
              repo: "acme/site",
              level: "local_only",
              master_enabled: true,
              effective_level: "local_only",
            },
            // A master-off row resolves `off`, whatever its level says.
            {
              repo: "acme/web",
              level: "on",
              master_enabled: false,
              effective_level: "off",
            },
            {
              repo: "acme/odd",
              level: "maybe",
              master_enabled: true,
              effective_level: "maybe",
            },
          ],
        })
      )
    ).toEqual([
      { repo: "acme/site", level: "local_only", raw: "local_only" },
      { repo: "acme/web", level: "off", raw: "off" },
      { repo: "acme/odd", level: null, raw: "maybe" },
    ]);
  });
});

describe("findOverride", () => {
  it("matches a repo the way coord does — ignoring case and padding", () => {
    const list = [override("acme/app", "off")];
    expect(findOverride(list, " Acme/App ")?.repo).toBe("acme/app");
    expect(findOverride(list, "acme/other")).toBeNull();
    expect(findOverride(null, "acme/app")).toBeNull();
  });
});

describe("overrideStatus", () => {
  const tenantOn = { state: "known", level: "on", defaulted: false } as const;

  it("a known override is calm and names the tenant level it overrides", () => {
    const s = overrideStatus(override("acme/app", "off"), { tenant: tenantOn });
    expect(s.kind).toBe("off");
    expect(s.label).toBe("Off");
    expect(s.attention).toBe("none");
    expect(s.reason).toBe("overrides the tenant setting (On)");
  });

  it("does not guess the tenant level when it is unknown", () => {
    const s = overrideStatus(override("acme/app", "local_only"), {
      tenant: { state: "no_declared_default", raw: "off" },
    });
    expect(s.reason).toBe("overrides the tenant setting");
  });

  it("an unrecognised level is UNKNOWN, amber, and named", () => {
    const s = overrideStatus(override("acme/app", null, "maybe"), {
      tenant: tenantOn,
    });
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe(UNKNOWN_DASH);
    expect(s.attention).toBe(IMAGE_GENERATION_ATTENTION_BY_KIND.unknown);
    expect(s.reason).toMatch(/"maybe"/);
  });

  it("a failed read-back is UNKNOWN whatever the list says", () => {
    const s = overrideStatus(override("acme/app", "on"), {
      tenant: tenantOn,
      readbackError: "read-back failed: coord returned 502",
    });
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe(UNKNOWN_DASH);
    expect(s.reason).toMatch(/502/);
  });

  it("a stale value keeps its badge but raises the row to waiting", () => {
    const s = overrideStatus(override("acme/app", "off"), {
      tenant: tenantOn,
      stale: true,
    });
    expect(s.kind).toBe("off");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toMatch(/may be stale/);
  });
});
