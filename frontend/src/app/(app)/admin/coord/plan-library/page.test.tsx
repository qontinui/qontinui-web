/**
 * `/admin/coord/plan-library` redirects to `/admin/coord/plans` — a bookmark
 * to the retired page still resolves (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1).
 */

import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

import PlanLibraryPage from "./page";

describe("/admin/coord/plan-library", () => {
  it("redirects to the unified plan browser", () => {
    PlanLibraryPage();
    expect(redirect).toHaveBeenCalledWith("/admin/coord/plans");
  });
});
