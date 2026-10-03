import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ESTIMATE_UPDATE_SCHEMA } from "@/components/overview/editing/__fixtures__/estimate-schema";
import type { EstimateRecord } from "../../_lib/estimate-api";

/**
 * The estimate editor on the authoring kit, against a mocked contract: one
 * Save is ONE write carrying the content and the source document on the
 * version the working copy was built on; a peer's save opens the conflict
 * dialog instead of being overwritten; a refused source saves nothing and
 * offers the save without it; a paste makes the save an import; the working
 * copy survives a reload; and a reader gets no controls.
 */

const mocks = vi.hoisted(() => ({
  canEdit: true,
  search: "from_document=doc-1",
  listResource: vi.fn(),
  getResource: vi.fn(),
  updateResource: vi.fn(),
  createResource: vi.fn(),
  fetchChangeLog: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("../../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: null,
    viewerId: "u1",
  }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useOverviewCatalog: () => ({
    state: "ready",
    catalog: { tenant_id: "p1", resources: [] },
  }),
  useResourceDescriptor: () => ({
    name: "estimates",
    can_edit: mocks.canEdit,
    schemas: { update: ESTIMATE_UPDATE_SCHEMA },
  }),
  EditGate: ({ children }: { children: React.ReactNode }) =>
    mocks.canEdit ? <>{children}</> : null,
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listResource: mocks.listResource,
  getResource: mocks.getResource,
  updateResource: mocks.updateResource,
  createResource: mocks.createResource,
  fetchChangeLog: mocks.fetchChangeLog,
}));

import {
  ResourceError,
  VersionConflictError,
} from "@/components/overview/editing/api";
import { draftKey, writeDraft } from "@/components/overview/editing/drafts";
import EstimateEditorRoute from "./page";

const ESTIMATE: EstimateRecord = {
  id: "e1",
  name: "Estimate v0.1",
  purpose: "budget",
  status: "draft",
  is_baseline: true,
  source_page_id: null,
  accuracy_note: null,
  contingency_pct: null,
  notes: "",
  version: 7,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  created_by: "a@example.com",
  updated_by: "a@example.com",
  content: {
    roles: [
      {
        id: "r1",
        code: "BE",
        name: "Backend",
        responsibility: "",
        day_rate_micros: 750_000_000,
        currency: "EUR",
        client_side: false,
        sort_order: 0,
      },
    ],
    phases: [],
    allocations: [],
    price_tiers: [],
    cost_lines: [],
    calendar_breaks: [],
  },
};

const DOC = {
  id: "doc-1",
  kind: "document",
  title: "Delivery plan",
  body_md: "No chart here.",
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.canEdit = true;
  mocks.search = "from_document=doc-1";
  mocks.listResource.mockResolvedValue({
    items: [{ ...ESTIMATE, content: null }],
    total: 1,
    can_edit: true,
    degraded: null,
  });
  mocks.getResource.mockImplementation(async (path: string) =>
    path === "pages"
      ? { item: DOC, can_edit: true }
      : { item: ESTIMATE, can_edit: true }
  );
});

async function showEditor() {
  render(<EstimateEditorRoute />);
  return (await screen.findByRole("button", {
    name: "Save the estimate",
  })) as HTMLButtonElement;
}

describe("the estimate editor", () => {
  it("saves the content and its source document as one write on the loaded version", async () => {
    const save = await showEditor();
    expect(screen.getByText(/Saving records it as this estimate/)).toBeTruthy();
    mocks.updateResource.mockResolvedValue({
      ...ESTIMATE,
      version: 8,
      source_page_id: "doc-1",
    });
    await act(async () => fireEvent.click(save));

    expect(mocks.updateResource).toHaveBeenCalledTimes(1);
    const [path, id, patch, version, source] =
      mocks.updateResource.mock.calls[0]!;
    expect([path, id, version, source]).toEqual(["estimates", "e1", 7, "ui"]);
    expect(patch.source_page_id).toBe("doc-1");
    expect(patch.content.roles).toEqual([
      {
        code: "BE",
        name: "Backend",
        responsibility: "",
        day_rate_micros: 750_000_000,
        currency: "EUR",
        client_side: false,
      },
    ]);
    expect(await screen.findByText(/Saved as version 8/)).toBeTruthy();
    expect(screen.getByText(/already recorded as this estimate/)).toBeTruthy();
  });

  it("shows both versions on a conflict, and saves on THEIR version without undoing them", async () => {
    const save = await showEditor();
    const theirs = {
      ...ESTIMATE,
      version: 9,
      updated_by: "b@example.com",
      content: { ...ESTIMATE.content!, roles: [] },
    };
    mocks.updateResource.mockRejectedValueOnce(
      new VersionConflictError(theirs)
    );
    await act(async () => fireEvent.click(save));

    expect(
      await screen.findByText(
        "Somebody else changed this while you were editing"
      )
    ).toBeTruthy();
    expect(screen.getByText(/b@example.com saved a new version/)).toBeTruthy();

    mocks.updateResource.mockResolvedValueOnce({ ...ESTIMATE, version: 10 });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save mine over theirs" })
      )
    );
    expect(mocks.updateResource).toHaveBeenCalledTimes(2);
    expect(mocks.updateResource.mock.calls[1]![3]).toBe(9);
    // I never touched the roles, so "mine" does not put back the role they
    // removed: only what I changed (here, the source link) is written over.
    expect(mocks.updateResource.mock.calls[1]![2].content.roles).toEqual([]);
    expect(mocks.updateResource.mock.calls[1]![2].source_page_id).toBe("doc-1");
  });

  it("keeps my changes and shows theirs beside them when combining", async () => {
    const save = await showEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "QA" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tester" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const theirs = {
      ...ESTIMATE,
      version: 9,
      content: { ...ESTIMATE.content!, roles: [] },
    };
    mocks.updateResource.mockRejectedValueOnce(
      new VersionConflictError(theirs)
    );
    await act(async () => fireEvent.click(save));
    fireEvent.click(
      await screen.findByRole("button", { name: "Combine them myself" })
    );
    expect(screen.getByRole("region", { name: "Their version" })).toBeTruthy();
    // My roles are still on screen…
    expect(screen.getByText("Tester")).toBeTruthy();
    // …until I take theirs.
    fireEvent.click(screen.getByRole("button", { name: "Take their roles" }));
    expect(screen.queryByText("Tester")).toBeNull();
    expect(screen.queryByText("Backend")).toBeNull();
    mocks.updateResource.mockResolvedValueOnce({ ...theirs, version: 10 });
    await act(async () => fireEvent.click(save));
    expect(mocks.updateResource.mock.calls[1]![3]).toBe(9);
    expect(mocks.updateResource.mock.calls[1]![2].content.roles).toEqual([]);
  });

  it("saves nothing when the source is refused, and offers the save without it", async () => {
    const save = await showEditor();
    mocks.updateResource.mockRejectedValueOnce(
      new ResourceError(422, "source_page_not_found", "not a document")
    );
    await act(async () => fireEvent.click(save));
    expect(
      await screen.findByText(
        /can.t be recorded as the estimate.s source. Nothing was saved./
      )
    ).toBeTruthy();

    mocks.updateResource.mockResolvedValueOnce({ ...ESTIMATE, version: 8 });
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save without recording a source" })
      )
    );
    const patch = mocks.updateResource.mock.calls[1]![2];
    expect(patch).not.toHaveProperty("source_page_id");
    expect(patch.content.roles).toHaveLength(1);
  });

  it("records a save that holds a paste as an import", async () => {
    mocks.search = "";
    const save = await showEditor();
    // Nothing to save yet: the working copy is the saved estimate.
    expect(save.disabled).toBe(true);
    const roles = screen
      .getByRole("heading", { name: "Roles and rates" })
      .closest("section")!;
    fireEvent.click(
      roles.querySelector(
        '[data-ui-bridge-id="overview.estimate-editor.roles.paste.open"]'
      )!
    );
    fireEvent.change(screen.getByLabelText("The pasted table"), {
      target: { value: "code,name\nQA,Tester" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Replace the roles with this one" })
    );
    expect(save.disabled).toBe(false);
    mocks.updateResource.mockResolvedValueOnce({ ...ESTIMATE, version: 8 });
    await act(async () => fireEvent.click(save));
    const [, , patch, , source] = mocks.updateResource.mock.calls[0]!;
    expect(source).toBe("import");
    expect(patch.content.roles.map((r: { code: string }) => r.code)).toEqual([
      "QA",
    ]);
    expect(patch).not.toHaveProperty("source_page_id");
  });

  it("brings back unsaved changes kept on this device, built on their old version", async () => {
    mocks.search = "";
    const empty = {
      roles: [],
      phases: [],
      allocations: [],
      efforts: [],
      priceTiers: [],
      costLines: [],
      calendarBreaks: [],
    };
    writeDraft(
      draftKey("p1", "estimates", "e1", "u1"),
      JSON.stringify({ schema: 1, imported: true, draft: empty, base: empty }),
      6
    );
    const save = await showEditor();
    expect(screen.getByText(/These are your unsaved changes/)).toBeTruthy();
    expect(screen.queryByText("Backend")).toBeNull();
    mocks.updateResource.mockResolvedValueOnce({ ...ESTIMATE, version: 8 });
    await act(async () => fireEvent.click(save));
    // Built on version 6, so a newer estimate is a conflict, not an overwrite.
    expect(mocks.updateResource.mock.calls[0]![3]).toBe(6);
    expect(mocks.updateResource.mock.calls[0]![4]).toBe("import");
  });

  it("offers a reader no controls at all", async () => {
    mocks.canEdit = false;
    render(<EstimateEditorRoute />);
    expect(
      await screen.findByText("You can read this estimate but not change it")
    ).toBeTruthy();
    await waitFor(() => expect(mocks.listResource).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Save the estimate" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Paste from a spreadsheet" })
    ).toBeNull();
  });

  it("keeps a peer's changes to what I never touched when I save mine over theirs", async () => {
    mocks.search = "";
    await showEditor();
    // I add a role…
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "QA" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tester" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // …while a peer records a cost line.
    const peerLine = {
      id: "c1",
      kind: "run_annual" as const,
      label: "Hosting",
      basis: "",
      low_micros: 1_000_000,
      high_micros: 2_000_000,
      currency: "EUR",
      phase_id: null,
      phase_code: null,
      run_model: null,
      sort_order: 0,
    };
    const theirs = {
      ...ESTIMATE,
      version: 9,
      content: { ...ESTIMATE.content!, cost_lines: [peerLine] },
    };
    mocks.updateResource.mockRejectedValueOnce(
      new VersionConflictError(theirs)
    );
    const save = screen.getByRole("button", { name: "Save the estimate" });
    await act(async () => fireEvent.click(save));
    mocks.updateResource.mockResolvedValueOnce({ ...theirs, version: 10 });
    await act(async () =>
      fireEvent.click(
        await screen.findByRole("button", { name: "Save mine over theirs" })
      )
    );
    const patch = mocks.updateResource.mock.calls[1]![2];
    expect(patch.content.roles.map((r: { code: string }) => r.code)).toEqual([
      "BE",
      "QA",
    ]);
    expect(
      patch.content.cost_lines.map((c: { label: string }) => c.label)
    ).toEqual(["Hosting"]);
  });

  it("holds Save while a row editor is open", async () => {
    mocks.search = "";
    const save = await showEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "QA" },
    });
    expect(save.disabled).toBe(true);
    expect(
      screen.getByText(/Finish or cancel the row you are editing/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Finish or cancel the row/)).toBeNull();
  });

  it("after keeping mine, a second conflict does not undo the first peer's work", async () => {
    mocks.search = "";
    await showEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "QA" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tester" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const line = {
      id: "c1",
      kind: "run_annual" as const,
      label: "Hosting",
      basis: "",
      low_micros: 1_000_000,
      high_micros: 2_000_000,
      currency: "EUR",
      phase_id: null,
      phase_code: null,
      run_model: null,
      sort_order: 0,
    };
    // Peer one adds a cost line; peer two, after them, deletes it again.
    const peerOne = {
      ...ESTIMATE,
      version: 9,
      content: { ...ESTIMATE.content!, cost_lines: [line] },
    };
    const peerTwo = {
      ...peerOne,
      version: 10,
      content: { ...peerOne.content, cost_lines: [] },
    };
    mocks.updateResource
      .mockRejectedValueOnce(new VersionConflictError(peerOne))
      .mockRejectedValueOnce(new VersionConflictError(peerTwo))
      .mockResolvedValueOnce({ ...peerTwo, version: 11 });

    const save = screen.getByRole("button", { name: "Save the estimate" });
    await act(async () => fireEvent.click(save));
    await act(async () =>
      fireEvent.click(
        await screen.findByRole("button", { name: "Save mine over theirs" })
      )
    );
    await act(async () =>
      fireEvent.click(
        await screen.findByRole("button", { name: "Save mine over theirs" })
      )
    );
    const third = mocks.updateResource.mock.calls[2]!;
    expect(third[3]).toBe(10);
    // Peer two's deletion stands: the line peer one added is not "mine".
    expect(third[2].content.cost_lines).toEqual([]);
    expect(third[2].content.roles.map((r: { code: string }) => r.code)).toEqual(
      ["BE", "QA"]
    );
  });

  it("offers no keep-mine when the merge would break, and says why", async () => {
    mocks.search = "";
    mocks.getResource.mockImplementation(async (path: string) =>
      path === "pages"
        ? { item: DOC, can_edit: true }
        : {
            item: {
              ...ESTIMATE,
              content: {
                ...ESTIMATE.content!,
                phases: [
                  {
                    id: "p1",
                    code: "A0",
                    name: "Mobilisation",
                    sort_order: 0,
                    planned_start: null,
                    planned_end: null,
                    stated_working_weeks: null,
                    gate_criteria: "",
                    actual_start: null,
                    actual_end: null,
                    gate_status: "pending",
                    gate_decided_at: null,
                    gate_notes: "",
                    tasks: [
                      {
                        id: "t1",
                        number: "1.1",
                        title: "Kick-off",
                        requirement_refs: null,
                        planned_start: null,
                        planned_end: null,
                        is_critical: false,
                        status: "planned",
                        sort_order: 0,
                        efforts: [],
                      },
                    ],
                  },
                ],
              },
            },
            can_edit: true,
          }
    );
    await showEditor();
    // I remove the only role…
    const row = screen.getByText("Backend").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    // …while they give that role days.
    const loaded = (await mocks.getResource.mock.results[0]!.value).item;
    const phase = loaded.content.phases[0];
    const theirs = {
      ...loaded,
      version: 9,
      content: {
        ...loaded.content,
        phases: [
          {
            ...phase,
            tasks: [
              {
                ...phase.tasks[0],
                efforts: [
                  { role_id: "r1", role_code: "BE", planned_person_days: "2" },
                ],
              },
            ],
          },
        ],
      },
    };
    mocks.updateResource.mockRejectedValueOnce(
      new VersionConflictError(theirs)
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save the estimate" }))
    );
    expect(
      await screen.findByText(/can.t simply be saved over theirs/)
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save mine over theirs" })
    ).toBeNull();
    expect(mocks.updateResource).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Combine them myself" })
    );
    expect(screen.getByRole("region", { name: "Their version" })).toBeTruthy();
  });

  it("warns before leaving while typed text is in no working copy", async () => {
    mocks.search = "";
    await showEditor();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "QA" },
    });
    fireEvent.click(
      screen.getByRole("link", { name: "Back to the Team page" })
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/NOT kept on this device/);
    confirm.mockRestore();
  });

  describe("rows a combine could not settle", () => {
    const task = (number: string, title: string, efforts: unknown[] = []) => ({
      id: `t-${number}`,
      number,
      title,
      requirement_refs: null,
      planned_start: null,
      planned_end: null,
      is_critical: false,
      status: "planned" as const,
      sort_order: 0,
      efforts,
    });
    const phase = (tasks: ReturnType<typeof task>[]) => ({
      id: "p1",
      code: "A0",
      name: "Mobilisation",
      sort_order: 0,
      planned_start: null,
      planned_end: null,
      stated_working_weeks: null,
      gate_criteria: "",
      actual_start: null,
      actual_end: null,
      gate_status: "pending" as const,
      gate_decided_at: null,
      gate_notes: "",
      tasks,
    });
    const effort = (days: string) => ({
      role_id: "r1",
      role_code: "BE",
      planned_person_days: days,
    });
    const PLANNED = {
      ...ESTIMATE,
      content: {
        ...ESTIMATE.content!,
        phases: [phase([task("1.1", "Kick-off", [effort("4.00")])])],
      },
    };
    // They renamed Kick-off AND added a task: nothing proves where my row goes.
    const THEIRS = {
      ...PLANNED,
      version: 9,
      content: {
        ...PLANNED.content,
        phases: [
          phase([
            task("1.1", "Start", [effort("4.00")]),
            task("1.2", "Review"),
          ]),
        ],
      },
    };
    const daysTable = () =>
      screen
        .getByRole("heading", { name: "Days of work per task" })
        .closest("section")!;

    async function combineAfterEditingMyDays() {
      mocks.search = "";
      mocks.getResource.mockImplementation(async (path: string) =>
        path === "pages"
          ? { item: DOC, can_edit: true }
          : { item: PLANNED, can_edit: true }
      );
      const save = await showEditor();
      fireEvent.click(
        within(daysTable()).getByRole("button", { name: "Edit" })
      );
      fireEvent.change(within(daysTable()).getByLabelText("Days"), {
        target: { value: "6" },
      });
      fireEvent.click(
        within(daysTable()).getByRole("button", { name: "Done" })
      );
      mocks.updateResource.mockRejectedValueOnce(
        new VersionConflictError(THEIRS)
      );
      await act(async () => fireEvent.click(save));
      fireEvent.click(
        await screen.findByRole("button", { name: "Combine them myself" })
      );
      return save;
    }

    it("holds Save until each flagged row is edited, and its note clears", async () => {
      const save = await combineAfterEditingMyDays();
      const notes = screen.getByRole("region", {
        name: "Left to settle from combining",
      });
      expect(
        within(notes).getByText(/task 1.1 of phase A0 \(BE\)/)
      ).toBeTruthy();
      expect(save.disabled).toBe(true);
      expect(screen.getByText(/Settle what combining left/)).toBeTruthy();

      // I put my days on the task they belong to now.
      fireEvent.click(
        within(daysTable()).getByRole("button", { name: "Edit" })
      );
      fireEvent.change(within(daysTable()).getByLabelText("Task"), {
        target: { value: "1.2" },
      });
      fireEvent.click(
        within(daysTable()).getByRole("button", { name: "Done" })
      );
      expect(
        screen.queryByRole("region", { name: "Left to settle from combining" })
      ).toBeNull();
      expect(save.disabled).toBe(false);
    });

    it("settles a flagged row the writer has checked, without editing it", async () => {
      const save = await combineAfterEditingMyDays();
      const notes = screen.getByRole("region", {
        name: "Left to settle from combining",
      });
      fireEvent.click(
        within(notes).getByRole("button", { name: "I have checked this" })
      );
      expect(
        screen.queryByRole("region", { name: "Left to settle from combining" })
      ).toBeNull();
      expect(save.disabled).toBe(false);
      // And the row stays as I wrote it.
      expect(within(daysTable()).getAllByText(/^6(\.0+)?$/).length).toBe(1);
    });

    it("does not bring back a stored note whose row is no longer in the copy", async () => {
      mocks.search = "";
      const empty = {
        roles: [],
        phases: [],
        allocations: [],
        efforts: [],
        priceTiers: [],
        costLines: [],
        calendarBreaks: [],
      };
      const gone = {
        phase_code: "A0",
        task_number: "1.1",
        role_code: "BE",
        planned_person_days: "6.00",
      };
      writeDraft(
        draftKey("p1", "estimates", "e1", "u1"),
        JSON.stringify({
          schema: 1,
          imported: false,
          draft: empty,
          base: empty,
          notes: [{ message: "Settled by an older build.", row: gone }],
        }),
        6
      );
      const save = await showEditor();
      expect(screen.getByText(/These are your unsaved changes/)).toBeTruthy();
      expect(
        screen.queryByRole("region", { name: "Left to settle from combining" })
      ).toBeNull();
      expect(save.disabled).toBe(false);
    });

    it("keeps the notes, and the hold, across a reload", async () => {
      await combineAfterEditingMyDays();
      cleanup();
      const save = await showEditor();
      expect(
        screen.getByRole("region", { name: "Left to settle from combining" })
      ).toBeTruthy();
      expect(save.disabled).toBe(true);
    });
  });

  describe("the leave guard", () => {
    const leaving = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it("is not armed by the source document's own, untouched gantt chart", async () => {
      mocks.getResource.mockImplementation(async (path: string) =>
        path === "pages"
          ? {
              item: {
                ...DOC,
                body_md:
                  "```mermaid\ngantt\n  dateFormat YYYY-MM-DD\n  section A0 X\n  T :a, 2026-01-05, 5d\n```",
              },
              can_edit: true,
            }
          : { item: ESTIMATE, can_edit: true }
      );
      await showEditor();
      expect(
        (screen.getByLabelText(/Import the schedule/) as HTMLTextAreaElement)
          .value
      ).toContain("gantt");
      expect(leaving()).toBe(false);
      fireEvent.change(screen.getByLabelText(/Import the schedule/), {
        target: { value: "gantt\n  section B0 Typed" },
      });
      expect(leaving()).toBe(true);
    });

    it("is disarmed when the CSV paste box is closed", async () => {
      mocks.search = "";
      await showEditor();
      const roles = screen
        .getByRole("heading", { name: "Roles and rates" })
        .closest("section")!;
      fireEvent.click(
        roles.querySelector(
          '[data-ui-bridge-id="overview.estimate-editor.roles.paste.open"]'
        )!
      );
      fireEvent.change(screen.getByLabelText("The pasted table"), {
        target: { value: "code,name\nQA,Tester" },
      });
      expect(leaving()).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(leaving()).toBe(false);
    });
  });
});

describe("a Save that would drop a phase holding recorded work", () => {
  const PHASED: EstimateRecord = {
    ...ESTIMATE,
    content: {
      ...ESTIMATE.content!,
      phases: [
        {
          id: "ph0",
          code: "A0",
          name: "Mobilisation",
          sort_order: 0,
          planned_start: "2026-01-05",
          planned_end: "2026-01-30",
          stated_working_weeks: null,
          gate_criteria: "",
          actual_start: null,
          actual_end: null,
          gate_status: "pending",
          gate_decided_at: null,
          gate_notes: "",
          tasks: [],
        },
      ],
    },
  };
  const PROGRESS = {
    id: "ph0",
    estimate_id: "e1",
    code: "A0",
    name: "Mobilisation",
    sort_order: 0,
    planned_start: "2026-01-05",
    planned_end: "2026-01-30",
    gate_criteria: "",
    actual_start: null,
    actual_end: null,
    gate_status: "pending",
    gate_decided_at: null,
    gate_notes: "",
    version: 1,
    updated_at: null,
    updated_by: null,
  };
  const MILESTONE = {
    id: "m1",
    title: "Pilot live",
    description: "",
    kind: "pilot",
    phase_id: "ph0",
    phase_code: "A0",
    target_date: "2026-01-20",
    completed_date: null,
    status: "planned",
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    updated_by: null,
  };
  const list = (items: unknown[]) => ({
    items,
    total: items.length,
    can_edit: true,
    degraded: null,
  });

  /** The project's resources as the server lists them. A function stands
   *  for a read that fails. */
  function serve({
    progress = [PROGRESS],
    milestones = [] as unknown[],
  }: {
    progress?: unknown[] | (() => never);
    milestones?: unknown[] | (() => never);
  }) {
    mocks.listResource.mockImplementation(async (path: string) => {
      if (path === "phase-progress") {
        return typeof progress === "function" ? progress() : list(progress);
      }
      if (path === "milestones") {
        return typeof milestones === "function"
          ? milestones()
          : list(milestones);
      }
      return list([{ ...PHASED, content: null }]);
    });
  }

  beforeEach(() => {
    mocks.search = "";
    mocks.getResource.mockResolvedValue({ item: PHASED, can_edit: true });
    mocks.updateResource.mockResolvedValue({ ...PHASED, version: 8 });
  });

  /** Re-import the schedule with the section's code changed: the chart
   *  cannot carry the phase's identity, so A0 is dropped and M0 is new. */
  async function reimportUnderANewCode(code = "M0") {
    const save = await showEditor();
    fireEvent.change(screen.getByLabelText(/Import the schedule/), {
      target: {
        value: `gantt\n  dateFormat YYYY-MM-DD\n  section ${code} Mobilisation\n  Kick-off :a, 2026-01-05, 5d`,
      },
    });
    const gantt = screen.getByLabelText(/Import the schedule/).closest("div")!;
    fireEvent.click(within(gantt).getByRole("button", { name: "Read it" }));
    fireEvent.click(
      within(gantt).getByRole("button", { name: "Use this schedule" })
    );
    return save;
  }

  it("names the phase and the recorded progress it would delete, and saves only when confirmed", async () => {
    serve({
      progress: [
        {
          ...PROGRESS,
          gate_status: "passed",
          gate_decided_at: "2026-01-30",
          actual_start: "2026-01-05",
          actual_end: "2026-01-30",
        },
      ],
    });
    const save = await reimportUnderANewCode();
    await act(async () => fireEvent.click(save));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Saving drops a phase that holds/)
    ).toBeTruthy();
    expect(within(dialog).getByText("A0")).toBeTruthy();
    expect(within(dialog).getByText(/Mobilisation/)).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Its recorded gate outcome (Passed) and actual start and end dates will be deleted."
      )
    ).toBeTruthy();
    expect(mocks.updateResource).not.toHaveBeenCalled();
    expect(mocks.listResource).toHaveBeenCalledWith("phase-progress", {
      estimate_id: "e1",
    });

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Drop them and save" })
      )
    );
    expect(mocks.updateResource).toHaveBeenCalledTimes(1);
    const [, , patch, version] = mocks.updateResource.mock.calls[0]!;
    expect(version).toBe(7);
    expect(patch.content.phases.map((p: { code: string }) => p.code)).toEqual([
      "M0",
    ]);
    // It acknowledges what the writer was shown, so a later change refuses it.
    expect(patch.acknowledged_drops).toEqual([
      { phase_id: "ph0", progress_version: 1, milestone_count: 0 },
    ]);
    expect(await screen.findByText(/Saved as version 8/)).toBeTruthy();
  });

  it("counts the milestones it would untie, and Cancel writes nothing", async () => {
    serve({ milestones: [MILESTONE, { ...MILESTONE, id: "m2" }] });
    const save = await reimportUnderANewCode();
    await act(async () => fireEvent.click(save));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/2 milestones will be untied from it/)
    ).toBeTruthy();
    expect(within(dialog).queryByText(/Its recorded/)).toBeNull();
    expect(mocks.listResource).toHaveBeenCalledWith("milestones", {
      phase_id: ["ph0"],
    });

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Cancel, keep editing" })
      )
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.updateResource).not.toHaveBeenCalled();
    // The working copy is untouched, ready to be corrected.
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("saves without asking when the dropped phase holds nothing", async () => {
    serve({});
    const save = await reimportUnderANewCode();
    await act(async () => fireEvent.click(save));
    await waitFor(() => expect(mocks.updateResource).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads nothing and asks nothing when no phase is dropped", async () => {
    serve({ progress: [{ ...PROGRESS, gate_status: "passed" }] });
    const save = await reimportUnderANewCode("A0");
    await act(async () => fireEvent.click(save));
    await waitFor(() => expect(mocks.updateResource).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.listResource).not.toHaveBeenCalledWith(
      "phase-progress",
      expect.anything()
    );
    // The kept phase is named by its id, so it keeps its progress.
    expect(mocks.updateResource.mock.calls[0]![2].content.phases[0].id).toBe(
      "ph0"
    );
  });

  it("says so when what the phase holds could not be checked, and lets the writer choose", async () => {
    serve({
      progress: () => {
        throw new Error("The server did not answer");
      },
    });
    const save = await reimportUnderANewCode();
    await act(async () => fireEvent.click(save));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "What the dropped phases hold could not be checked"
      )
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/Saving drops A0 Mobilisation/)
    ).toBeTruthy();
    expect(within(dialog).getByText(/The server did not answer/)).toBeTruthy();
    expect(mocks.updateResource).not.toHaveBeenCalled();

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Save anyway" })
      )
    );
    expect(mocks.updateResource).toHaveBeenCalledTimes(1);
    // Nothing was seen, so nothing is acknowledged: the server says what is
    // at stake, if anything is.
    expect(mocks.updateResource.mock.calls[0]![2]).not.toHaveProperty(
      "acknowledged_drops"
    );
  });

  it("asks again, with what the phase holds now, when work was recorded on it after the check", async () => {
    serve({}); // A0 held nothing when it was checked.
    mocks.updateResource.mockRejectedValueOnce(
      new ResourceError(409, "unacknowledged_drop", "Nothing was saved.", {
        error: "unacknowledged_drop",
        message: "Nothing was saved.",
        phases: [
          {
            phase_id: "ph0",
            code: "A0",
            name: "Mobilisation",
            progress_version: 2,
            milestone_count: 0,
            actual_start: null,
            actual_end: null,
            gate_status: "passed",
            gate_decided_at: "2026-01-30",
            gate_notes: "",
          },
        ],
      })
    );
    const save = await reimportUnderANewCode();
    await act(async () => fireEvent.click(save));
    await waitFor(() => expect(mocks.updateResource).toHaveBeenCalledTimes(1));
    expect(mocks.updateResource.mock.calls[0]![2].acknowledged_drops).toEqual([
      { phase_id: "ph0", progress_version: 1, milestone_count: 0 },
    ]);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/work was recorded on this phase since/)
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Its recorded gate outcome (Passed) will be deleted."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/It could not be saved/)).toBeNull();

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Drop them and save" })
      )
    );
    expect(mocks.updateResource).toHaveBeenCalledTimes(2);
    expect(mocks.updateResource.mock.calls[1]![2].acknowledged_drops).toEqual([
      { phase_id: "ph0", progress_version: 2, milestone_count: 0 },
    ]);
    expect(await screen.findByText(/Saved as version 8/)).toBeTruthy();
  });

  it("checks the drop again when saving without the refused source", async () => {
    mocks.search = "from_document=doc-1";
    mocks.getResource.mockImplementation(async (path: string) =>
      path === "pages"
        ? { item: DOC, can_edit: true }
        : { item: PHASED, can_edit: true }
    );
    serve({ progress: [{ ...PROGRESS, gate_status: "passed" }] });
    mocks.updateResource.mockRejectedValueOnce(
      new ResourceError(422, "source_page_not_found", "not a document")
    );
    const save = await reimportUnderANewCode();
    await act(async () => fireEvent.click(save));
    await act(async () =>
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Drop them and save",
        })
      )
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.updateResource).toHaveBeenCalledTimes(1);

    await act(async () =>
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Save without recording a source",
        })
      )
    );
    // Asked again before anything is written — never a silent drop.
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Saving drops a phase that holds/)
    ).toBeTruthy();
    expect(mocks.updateResource).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Drop them and save" })
      )
    );
    expect(mocks.updateResource).toHaveBeenCalledTimes(2);
    const patch = mocks.updateResource.mock.calls[1]![2];
    expect(patch).not.toHaveProperty("source_page_id");
    expect(patch.acknowledged_drops).toEqual([
      { phase_id: "ph0", progress_version: 1, milestone_count: 0 },
    ]);
  });
});
