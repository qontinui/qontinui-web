/**
 * Self-targeting guard regression tests for the /co-pilot surface.
 *
 * The AI co-pilot drives OTHER pages after it soft-navigates away — it must
 * never ground a step on its OWN controls or "navigate to /co-pilot" from
 * /co-pilot. Two guards enforce this:
 *
 *   1. The page's root wrapper carries ``data-bridge-invisible="true"`` so the
 *      SDK's AutoRegister ancestor walk skips the whole co-pilot surface (the
 *      prompt input, Run/Clear buttons, summary, timeline, suggestions). This
 *      mirrors the guard on ``CoPilotActiveBanner.tsx``.
 *   2. ``copilotPages`` (the planner's targetable page list) excludes the
 *      ``/co-pilot`` self route.
 *
 * Mirrors the ``data-bridge-invisible`` assertion pattern from
 * ``components/co-pilot/CoPilotActiveBanner.test.tsx``.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---- Mock the page's heavy hooks to land on the enabled+consented branch
// (the prompt surface) without pulling in react-query / context providers /
// the relay + plan clients. ----
vi.mock("@/hooks/useCoPilotPreference", () => ({
  useCoPilotPreference: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("@/hooks/useCoPilotSessionConsent", () => ({
  useCoPilotSessionConsent: () => ({
    state: "granted",
    grant: vi.fn(),
    revoke: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ({
    activeRunner: { id: "runner-1" },
    runners: [],
    selectRunner: vi.fn(),
    isMultiRunner: false,
  }),
}));
vi.mock("@/lib/co-pilot/usePromptExecution", () => ({
  usePromptExecution: () => ({
    state: {
      phase: "idle",
      plan: null,
      stepStatuses: [],
      currentStepIndex: -1,
      summary: null,
      error: null,
    },
    run: vi.fn(),
    reset: vi.fn(),
  }),
}));

import CoPilotPage from "./page";

afterEach(() => {
  cleanup();
});

describe("/co-pilot self-targeting guard", () => {
  it("wraps the prompt surface so the prompt input + submit are bridge-invisible", () => {
    render(<CoPilotPage />);

    const input = screen.getByTestId("co-pilot-prompt-input");
    const submit = screen.getByTestId("co-pilot-submit");

    // Both core controls must sit under a data-bridge-invisible ancestor so
    // AutoRegister skips them — the planner can never target the co-pilot's
    // own form.
    expect(input.closest("[data-bridge-invisible='true']")).not.toBeNull();
    expect(submit.closest("[data-bridge-invisible='true']")).not.toBeNull();
  });

  it("excludes /co-pilot from the planner's targetable page list", async () => {
    const { copilotPages, pageMap, pageIdToUrl } = await import(
      "@/lib/co-pilot/pageMap"
    );

    // No targetable page resolves to the co-pilot's own route.
    const routes = Object.values(pageMap);
    expect(routes).not.toContain("/co-pilot");
    expect(copilotPages.some((p) => pageIdToUrl(p.id) === "/co-pilot")).toBe(
      false
    );
  });
});
