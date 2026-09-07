/**
 * describeTenantBindings — the tri-state must survive presentation:
 *   null      → "unknown" (never "none")
 *   []        → "none"
 *   populated → "bound", one chip per binding, slug-or-id-prefix label,
 *               full id + last-active in the title
 */

import { describe, it, expect } from "vitest";
import {
  describeTenantBindings,
  formatLastActive,
} from "./tenantBindings";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("describeTenantBindings", () => {
  it("treats null as UNKNOWN, not as an empty set", () => {
    expect(describeTenantBindings(null)).toEqual({ kind: "unknown", chips: [] });
  });

  it("treats an absent value (undefined) as UNKNOWN", () => {
    expect(describeTenantBindings(undefined)).toEqual({
      kind: "unknown",
      chips: [],
    });
  });

  it("treats [] as a measured zero", () => {
    expect(describeTenantBindings([])).toEqual({ kind: "none", chips: [] });
  });

  it("renders one chip per binding with slug-or-id-prefix labels", () => {
    const summary = describeTenantBindings(
      [
        {
          tenant_id: TENANT_A,
          tenant_slug: "acme",
          last_active_at: "2026-09-05T08:00:00Z",
        },
        { tenant_id: TENANT_B, tenant_slug: null, last_active_at: null },
      ],
      (ts) => (ts === null ? "never" : `T(${ts})`)
    );

    expect(summary.kind).toBe("bound");
    expect(summary.chips).toEqual([
      {
        key: TENANT_A,
        label: "acme",
        title: `Tenant ${TENANT_A} · last active T(2026-09-05T08:00:00Z)`,
      },
      {
        key: TENANT_B,
        label: "bbbbbbbb",
        title: `Tenant ${TENANT_B} · last active never`,
      },
    ]);
  });
});

describe("formatLastActive", () => {
  it("reads null as never", () => {
    expect(formatLastActive(null)).toBe("never");
  });

  it("reads an unparseable timestamp as unknown time", () => {
    expect(formatLastActive("not-a-date")).toBe("unknown time");
  });

  it("localizes a valid timestamp", () => {
    const iso = "2026-09-05T08:00:00Z";
    expect(formatLastActive(iso)).toBe(new Date(iso).toLocaleString());
  });
});
