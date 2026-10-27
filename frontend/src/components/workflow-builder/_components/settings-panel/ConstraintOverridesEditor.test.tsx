/**
 * ConstraintOverridesEditor reads the active constraints, which only a
 * platform admin may (coord finding `5a6791e9-607c-4658-82e2-3b509e459996`).
 * A refusal renders the admin-only state and a failed read a labelled UNKNOWN
 * with its reason; neither renders as "No constraints configured" or offers a
 * toggle, and the workflow's own overrides, which still apply, are counted.
 *
 * The network is stubbed at `httpClient.fetch` (`src/test/constraintsRoutes.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import {
  ADMIN_REFUSED,
  NO_SECRETS,
  RUNNER_UNREACHABLE,
  RUNNER_UNREACHABLE_SENTENCE,
  ok,
  respond,
  type RouteAnswer,
} from "@/test/constraintsRoutes";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

import { CONSTRAINTS_ADMIN_ONLY } from "@/lib/constraints-api";
import { ConstraintOverridesEditor } from "./ConstraintOverridesEditor";

function renderEditor(
  answer: RouteAnswer,
  overrides?: Record<string, boolean>
) {
  fetchMock.mockResolvedValue(respond(answer));
  const workflow = { constraintOverrides: overrides } as UnifiedWorkflow;
  return render(
    <ConstraintOverridesEditor
      workflow={workflow}
      updateWorkflow={vi.fn()}
      selectClass=""
    />
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function expectNoListAndNoToggle(): void {
  expect(screen.queryByText(/No constraints configured/)).toBeNull();
  expect(screen.queryByText(NO_SECRETS.name)).toBeNull();
  expect(screen.queryByText("Default")).toBeNull();
  expect(screen.queryByText("Force Off")).toBeNull();
}

describe("ConstraintOverridesEditor", () => {
  it("shows a viewer who is not a platform admin the admin-only state", async () => {
    renderEditor(ADMIN_REFUSED, { [NO_SECRETS.id]: false });

    const note = await screen.findByTestId("constraint-overrides-admin-only");
    expect(note.textContent).toContain(CONSTRAINTS_ADMIN_ONLY);
    expectNoListAndNoToggle();
    expect(screen.getByTestId("constraint-overrides-count").textContent).toBe(
      "This workflow sets 1 constraint override, which still apply."
    );
  });

  it("labels a failed read as unknown, with its reason", async () => {
    renderEditor(RUNNER_UNREACHABLE);

    const note = await screen.findByTestId("constraint-overrides-read-failed");
    expect(note.textContent).toContain("is unknown");
    expect(note.textContent).toContain(
      `Reason: Failed to fetch active constraints: ${RUNNER_UNREACHABLE_SENTENCE}`
    );
    expectNoListAndNoToggle();
    expect(screen.queryByTestId("constraint-overrides-admin-only")).toBeNull();
    expect(screen.queryByTestId("constraint-overrides-count")).toBeNull();
  });

  it("lists the constraints with their override toggles for an admin", async () => {
    renderEditor(ok([NO_SECRETS]), { [NO_SECRETS.id]: false });

    expect(await screen.findByText(NO_SECRETS.name)).toBeTruthy();
    expect(screen.getByText("Force Off")).toBeTruthy();
    expect(screen.queryByTestId("constraint-overrides-admin-only")).toBeNull();
    expect(screen.queryByTestId("constraint-overrides-read-failed")).toBeNull();
  });

  it("says none are configured only when the read delivered none", async () => {
    renderEditor(ok([]));

    expect(await screen.findByText(/No constraints configured/)).toBeTruthy();
  });
});
