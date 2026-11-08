/**
 * The operator's corrections (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * D11): each dialog sends exactly coord's contract body, acknowledges a
 * success, and keeps a refusal on screen with what was typed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const updateSubproject = vi.fn();
const mergeSubproject = vi.fn();
const changeSubprojectMember = vi.fn();
const fetchSubprojects = vi.fn();
vi.mock("@/lib/api/operations/coordSubprojects", () => ({
  updateSubproject: (...a: unknown[]) => updateSubproject(...a),
  mergeSubproject: (...a: unknown[]) => mergeSubproject(...a),
  changeSubprojectMember: (...a: unknown[]) => changeSubprojectMember(...a),
  fetchSubprojects: (...a: unknown[]) => fetchSubprojects(...a),
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

import {
  MergeDialog,
  MoveDialog,
  SubprojectTextDialog,
  memberRequest,
} from "./SubprojectDialogs";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const TARGET = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";
const SESSION = "6c3e0aac-0000-4000-8000-000000000001";
const SUBPROJECT = { id: ID, title: "dashboards-and-presentation" };

describe("SubprojectTextDialog", () => {
  beforeEach(() => {
    updateSubproject.mockReset();
    toastSuccess.mockReset();
  });

  it("renames with exactly the title, then acknowledges and hands back", async () => {
    updateSubproject.mockResolvedValue({ id: ID, title: "Dashboards" });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <SubprojectTextDialog
        open
        onClose={onClose}
        field="title"
        subprojectId={ID}
        initial="dashboards-and-presentation-27-10"
        onSaved={onSaved}
      />
    );
    const save = screen.getByTestId("subproject-title-save");
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(screen.getByTestId("subproject-title-input"), {
      target: { value: "  Dashboards  " },
    });
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateSubproject).toHaveBeenCalledWith(ID, { title: "Dashboards" });
    expect(toastSuccess).toHaveBeenCalledWith("Title saved");
    expect(onClose).toHaveBeenCalled();
  });

  it("never sends an empty title", () => {
    render(
      <SubprojectTextDialog
        open
        onClose={vi.fn()}
        field="title"
        subprojectId={ID}
        initial="x"
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("subproject-title-input"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("subproject-title-save")).toBeDisabled();
  });

  it("keeps a refusal on screen, with what was typed", async () => {
    updateSubproject.mockRejectedValue(
      new Error(
        `PATCH /api/v1/operations/subprojects/${ID} failed: 409 - {"error":"title_taken","message":"another subproject has that title"}`
      )
    );
    const onClose = vi.fn();
    render(
      <SubprojectTextDialog
        open
        onClose={onClose}
        field="goal"
        subprojectId={ID}
        initial=""
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("subproject-goal-input"), {
      target: { value: "Ship presentation spaces" },
    });
    fireEvent.click(screen.getByTestId("subproject-goal-save"));
    expect(
      await screen.findByTestId("subproject-goal-error")
    ).toBeInTheDocument();
    expect(updateSubproject).toHaveBeenCalledWith(ID, {
      goal: "Ship presentation spaces",
    });
    expect(screen.getByTestId("subproject-goal-input")).toHaveValue(
      "Ship presentation spaces"
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("MergeDialog", () => {
  beforeEach(() => {
    mergeSubproject.mockReset();
    fetchSubprojects.mockReset();
    toastSuccess.mockReset();
  });

  it("merges into a typed id when the open subprojects cannot be read, and says so", async () => {
    fetchSubprojects.mockRejectedValue(new TypeError("Failed to fetch"));
    mergeSubproject.mockResolvedValue({
      merged_into: TARGET,
      moved_members: 3,
    });
    const onMerged = vi.fn();
    render(
      <MergeDialog
        open
        onClose={vi.fn()}
        subproject={SUBPROJECT}
        onMerged={onMerged}
      />
    );
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    const submit = screen.getByTestId("subproject-merge-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("subproject-merge-target-input"), {
      target: { value: TARGET },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(TARGET));
    expect(mergeSubproject).toHaveBeenCalledWith(ID, TARGET);
    expect(toastSuccess).toHaveBeenCalledWith(
      `Merged into ${TARGET}: 3 members moved`
    );
  });

  it("refuses to merge a subproject into itself", async () => {
    fetchSubprojects.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <MergeDialog
        open
        onClose={vi.fn()}
        subproject={SUBPROJECT}
        onMerged={vi.fn()}
      />
    );
    fireEvent.change(
      await screen.findByTestId("subproject-merge-target-input"),
      {
        target: { value: ID },
      }
    );
    expect(screen.getByTestId("subproject-merge-submit")).toBeDisabled();
  });
});

describe("MoveDialog", () => {
  beforeEach(() => {
    changeSubprojectMember.mockReset();
    fetchSubprojects.mockReset();
  });

  it("moves a session into this subproject by its harness id", async () => {
    changeSubprojectMember.mockResolvedValue({ member: {} });
    const onMoved = vi.fn();
    render(
      <MoveDialog
        open
        onClose={vi.fn()}
        subproject={SUBPROJECT}
        preset={null}
        onMoved={onMoved}
      />
    );
    const submit = screen.getByTestId("subproject-move-submit");
    fireEvent.change(screen.getByTestId("subproject-move-member"), {
      target: { value: "not-a-session" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("subproject-move-member"), {
      target: { value: SESSION },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(changeSubprojectMember).toHaveBeenCalledWith(ID, {
      action: "move",
      member_kind: "session",
      agent_session_id: SESSION,
    });
  });

  it("moves a member out to the subproject typed, not to this one", async () => {
    fetchSubprojects.mockRejectedValue(new TypeError("Failed to fetch"));
    changeSubprojectMember.mockResolvedValue({ member: {} });
    const onMoved = vi.fn();
    render(
      <MoveDialog
        open
        onClose={vi.fn()}
        subproject={SUBPROJECT}
        preset={{ kind: "session", id: SESSION, label: "dashboards-27-10" }}
        onMoved={onMoved}
      />
    );
    fireEvent.change(
      await screen.findByTestId("subproject-move-target-input"),
      {
        target: { value: TARGET },
      }
    );
    fireEvent.click(screen.getByTestId("subproject-move-submit"));
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(changeSubprojectMember).toHaveBeenCalledWith(TARGET, {
      action: "move",
      member_kind: "session",
      agent_session_id: SESSION,
    });
  });
});

describe("memberRequest", () => {
  it("names a work unit by id when it is a uuid, else by slug", () => {
    expect(
      memberRequest("attach", "work_unit", "2026-10-27-spawn-time-effort")
    ).toEqual({
      action: "attach",
      member_kind: "work_unit",
      work_unit_slug: "2026-10-27-spawn-time-effort",
    });
    expect(memberRequest("remove", "work_unit", ` ${TARGET} `)).toEqual({
      action: "remove",
      member_kind: "work_unit",
      work_unit_id: TARGET,
    });
    expect(memberRequest("move", "session", SESSION)).toEqual({
      action: "move",
      member_kind: "session",
      agent_session_id: SESSION,
    });
  });
});
