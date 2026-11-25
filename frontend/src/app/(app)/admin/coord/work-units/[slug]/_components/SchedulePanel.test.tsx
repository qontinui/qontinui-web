/**
 * The Schedule panel on `/admin/coord/work-units/[slug]` — entering the
 * phases and links the Project Overview derives from coord.
 *
 * Pinned (each can fail on its own): an admin sees the stored phases and
 * saves an edit through `PATCH /plans/{slug}/schedule-metadata` with the
 * patch built from the draft and the unit's `updated_at` as the lock; a
 * non-admin sees no controls; an invalid draft cannot be saved and says why;
 * a stored entry the panel cannot read blocks the save instead of being
 * dropped; coord's refusal text reaches the operator.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const httpFetchPatch = vi.fn();
vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: vi.fn(),
      post: vi.fn(),
      patch: (...args: unknown[]) => httpFetchPatch(...args),
    }),
  };
});

let mockIsAdmin = true;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: mockIsAdmin }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { SchedulePanel } from "./SchedulePanel";

const SLUG = "2026-10-16-the-programme";
const PLAN = {
  slug: SLUG,
  updated_at: "2026-11-25T10:00:00Z",
  metadata: {
    phases: [{ index: 1, name: "F1" }],
    phase_units: { "1": ["child-a"] },
  },
};

function openPanel() {
  // Collapsed by default: the toggle is the panel's header button.
  const root = screen.getByTestId("coord-plan-schedule");
  const toggle = root.querySelector("button");
  if (toggle) fireEvent.click(toggle);
}

describe("SchedulePanel", () => {
  beforeEach(() => {
    httpFetchPatch.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    mockIsAdmin = true;
    window.localStorage.clear();
  });

  it("shows the stored phases and saves an edit as a patch with the lock", async () => {
    httpFetchPatch.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<SchedulePanel slug={SLUG} plan={PLAN} onSaved={onSaved} />);
    openPanel();

    expect(await screen.findByTestId("coord-plan-schedule-name")).toHaveValue(
      "F1"
    );
    expect(screen.getByTestId("coord-plan-schedule-units")).toHaveValue(
      "child-a"
    );
    // Unchanged draft: nothing to save.
    expect(screen.getByTestId("coord-plan-schedule-save")).toBeDisabled();

    fireEvent.change(screen.getByTestId("coord-plan-schedule-milestone"), {
      target: { value: "V1" },
    });
    fireEvent.change(screen.getByTestId("coord-plan-schedule-end"), {
      target: { value: "2026-12-01" },
    });
    const save = screen.getByTestId("coord-plan-schedule-save");
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, body] = httpFetchPatch.mock.calls[0] as [
      string,
      {
        from_updated_at: string;
        metadata_patch: { phases: unknown; phase_units: unknown };
      },
    ];
    expect(String(url)).toContain(`/plans/${SLUG}/schedule-metadata`);
    expect(body.from_updated_at).toBe(PLAN.updated_at);
    expect(body.metadata_patch.phases).toEqual([
      { index: 1, name: "F1", milestone: "V1", planned_end: "2026-12-01" },
    ]);
    expect(body.metadata_patch.phase_units).toEqual({ "1": ["child-a"] });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("keeps unsaved edits across a refetch that changed nothing", async () => {
    const { rerender } = render(
      <SchedulePanel slug={SLUG} plan={PLAN} onSaved={vi.fn()} />
    );
    openPanel();
    fireEvent.change(await screen.findByTestId("coord-plan-schedule-name"), {
      target: { value: "F1 half typed" },
    });
    // The page re-reads the unit (e.g. after a status transition): a NEW
    // object with identical content.
    rerender(
      <SchedulePanel
        slug={SLUG}
        plan={{ ...PLAN, metadata: JSON.parse(JSON.stringify(PLAN.metadata)) }}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByTestId("coord-plan-schedule-name")).toHaveValue(
      "F1 half typed"
    );
    // ...but a re-read that CHANGED what coord holds restarts the draft.
    rerender(
      <SchedulePanel
        slug={SLUG}
        plan={{
          ...PLAN,
          metadata: { phases: [{ index: 1, name: "F1 by someone else" }] },
        }}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByTestId("coord-plan-schedule-name")).toHaveValue(
      "F1 by someone else"
    );
  });

  it("cannot save an invalid draft and says why", async () => {
    render(<SchedulePanel slug={SLUG} plan={PLAN} onSaved={vi.fn()} />);
    openPanel();
    fireEvent.change(await screen.findByTestId("coord-plan-schedule-start"), {
      target: { value: "next week" },
    });
    expect(screen.getByTestId("coord-plan-schedule-problems")).toHaveTextContent(
      /planned start must look like/
    );
    expect(screen.getByTestId("coord-plan-schedule-save")).toBeDisabled();
    expect(httpFetchPatch).not.toHaveBeenCalled();
  });

  it("blocks the save when a stored entry cannot be read", async () => {
    render(
      <SchedulePanel
        slug={SLUG}
        plan={{ ...PLAN, metadata: { phases: [{ index: "x", name: "bad" }] } }}
        onSaved={vi.fn()}
      />
    );
    openPanel();
    expect(
      await screen.findByTestId("coord-plan-schedule-problems")
    ).toHaveTextContent(/could not be read/);
    expect(screen.getByTestId("coord-plan-schedule-save")).toBeDisabled();
  });

  it("adds a phase with the next free index", async () => {
    render(<SchedulePanel slug={SLUG} plan={PLAN} onSaved={vi.fn()} />);
    openPanel();
    fireEvent.click(await screen.findByTestId("coord-plan-schedule-add"));
    const indexes = screen.getAllByTestId("coord-plan-schedule-index");
    expect(indexes.map((i) => (i as HTMLInputElement).value)).toEqual([
      "1",
      "2",
    ]);
  });

  it("shows coord's refusal and keeps the draft", async () => {
    httpFetchPatch.mockRejectedValue(
      new Error('phase_units key `9` is not a declared phase index')
    );
    render(<SchedulePanel slug={SLUG} plan={PLAN} onSaved={vi.fn()} />);
    openPanel();
    fireEvent.change(await screen.findByTestId("coord-plan-schedule-units"), {
      target: { value: "child-a, child-b" },
    });
    fireEvent.click(screen.getByTestId("coord-plan-schedule-save"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/not a declared phase/);
    expect(screen.getByTestId("coord-plan-schedule-units")).toHaveValue(
      "child-a, child-b"
    );
  });

  it("gives a non-administrator no controls", async () => {
    mockIsAdmin = false;
    render(<SchedulePanel slug={SLUG} plan={PLAN} onSaved={vi.fn()} />);
    openPanel();
    expect(await screen.findByTestId("coord-admin-only-notice")).toBeTruthy();
    expect(screen.queryByTestId("coord-plan-schedule-save")).toBeNull();
  });
});
