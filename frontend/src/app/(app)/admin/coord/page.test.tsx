/**
 * /admin/coord — the console's landing page, proven presentation-ready (plan
 * `2026-10-23-console-presentation-spaces`; `presentationReadiness.ts` names
 * this file as the proof).
 *
 * The page renders one sentence while it redirects to the console, so in
 * presentation mode it is safe to show — and it must be shown: a withheld page
 * never mounts, so it never redirects, and `/admin/coord` is where `/`,
 * `/login` and `/dashboard` send a signed-in user. The redirect keeps the
 * query, so a `?present=1` arrival lands presenting. Its target is
 * `/admin/coord/home`, the operator's one screen (plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4).
 */

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import CoordLandingPage from "./page";

beforeEach(() => router.replace.mockReset());
afterEach(() => window.history.replaceState(null, "", "/"));

describe("/admin/coord in presentation mode", () => {
  it("is safe to show: one sentence, no control, no figure, no identity", () => {
    window.history.replaceState(null, "", "/admin/coord?present=1");
    const view = renderInPresentationMode(<CoordLandingPage />);
    expect(screen.getByTestId("coord-landing")).toHaveTextContent(
      "Loading operator console..."
    );
    expectPresentationSafe(view);
  });

  it("redirects to the one screen carrying the URL's query", () => {
    window.history.replaceState(null, "", "/admin/coord?present=1");
    renderInPresentationMode(<CoordLandingPage />);
    expect(router.replace).toHaveBeenCalledWith("/admin/coord/home?present=1");
  });

  it("adds no query of its own", () => {
    window.history.replaceState(null, "", "/admin/coord");
    renderInPresentationMode(<CoordLandingPage />);
    expect(router.replace).toHaveBeenCalledWith("/admin/coord/home");
  });
});
