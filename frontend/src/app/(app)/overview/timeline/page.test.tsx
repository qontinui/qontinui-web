import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateRecord } from "../_lib/estimate-api";
import type {
  Milestone,
  PhaseProgress,
  TimelineForecast,
} from "../_lib/timeline-api";

/**
 * The Timeline against a mocked contract: the header words a slip and never
 * shows it as a signed number; each phase is drawn with its gate's outcome;
 * recording progress is a write to `phase-progress` on that record's own
 * version, refused first when it does not add up, and a peer's save is a
 * conflict rather than an overwrite; a milestone is added through the kit's
 * table; a reader gets no controls; no estimate is said, not drawn empty.
 */

const mocks = vi.hoisted(() => ({
  canEdit: true,
  estimates: [] as unknown[],
  listResource: vi.fn(),
  getResource: vi.fn(),
  updateResource: vi.fn(),
  createResource: vi.fn(),
  deleteMilestone: vi.fn(),
  fetchChangeLog: vi.fn(),
  fetchForecast: vi.fn(),
}));

vi.mock("../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: null,
    viewerId: "u1",
  }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useCanEdit: () => mocks.canEdit,
  useResourceDescriptor: () => ({
    name: "milestones",
    can_edit: mocks.canEdit,
    schemas: {
      create: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          target_date: { type: "string", format: "date" },
        },
      },
    },
  }),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listResource: mocks.listResource,
  getResource: mocks.getResource,
  updateResource: mocks.updateResource,
  createResource: mocks.createResource,
  deleteMilestone: mocks.deleteMilestone,
  fetchChangeLog: mocks.fetchChangeLog,
}));
vi.mock("../_lib/timeline-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchForecast: mocks.fetchForecast,
}));

import { VersionConflictError } from "@/components/overview/editing/api";
import TimelinePage from "./page";

const PHASE_PLAN = [
  ["ph0", "A0", "Mobilisation", "2026-01-05", "2026-01-30"],
  ["ph1", "A1", "Discovery", "2026-02-02", "2026-02-27"],
  ["ph2", "A2", "Build", "2026-03-02", "2026-03-27"],
] as const;

const ESTIMATE: EstimateRecord = {
  id: "e1",
  name: "Estimate v0.1",
  purpose: "budget",
  status: "approved",
  is_baseline: true,
  source_page_id: null,
  accuracy_note: null,
  contingency_pct: null,
  notes: "",
  version: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by: null,
  updated_by: null,
  content: {
    roles: [],
    phases: PHASE_PLAN.map(([id, code, name, start, end], index) => ({
      id,
      code,
      name,
      sort_order: index,
      planned_start: start,
      planned_end: end,
      stated_working_weeks: null,
      gate_criteria: `Gate ${code}`,
      actual_start: null,
      actual_end: null,
      gate_status: "pending" as const,
      gate_decided_at: null,
      gate_notes: "",
      tasks:
        code === "A1"
          ? [
              {
                id: "t1",
                number: "2.1",
                title: "Interview the sponsors",
                requirement_refs: null,
                planned_start: "2026-02-02",
                planned_end: "2026-02-06",
                is_critical: true,
                status: "planned" as const,
                sort_order: 0,
                efforts: [],
              },
            ]
          : [],
    })),
    allocations: [],
    price_tiers: [],
    cost_lines: [],
    calendar_breaks: [
      {
        id: "b1",
        label: "Carnival",
        start_date: "2026-02-16",
        end_date: "2026-02-17",
      },
    ],
  },
};

function progress(
  index: number,
  over: Partial<PhaseProgress> = {}
): PhaseProgress {
  const [id, code, name, start, end] = PHASE_PLAN[index]!;
  return {
    id,
    estimate_id: "e1",
    code,
    name,
    sort_order: index,
    planned_start: start,
    planned_end: end,
    gate_criteria: `Gate ${code}`,
    actual_start: null,
    actual_end: null,
    gate_status: "pending",
    gate_decided_at: null,
    gate_notes: "",
    version: 1,
    updated_at: null,
    updated_by: null,
    ...over,
  };
}

const PROGRESS: PhaseProgress[] = [
  progress(0, {
    actual_start: "2026-01-05",
    actual_end: "2026-02-09",
    gate_status: "passed",
    gate_decided_at: "2026-02-09",
    version: 3,
  }),
  progress(1, { actual_start: "2026-02-10" }),
  progress(2),
];

const MILESTONE: Milestone = {
  id: "m1",
  title: "Pilot live",
  description: "",
  kind: "pilot",
  phase_id: "ph2",
  phase_code: "A2",
  target_date: "2026-03-20",
  completed_date: null,
  status: "planned",
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by: null,
  updated_by: null,
};

function forecast(slip: number): TimelineForecast {
  return {
    estimate_id: "e1",
    estimate_version: 3,
    today: "2026-02-20",
    planned_start: "2026-01-05",
    planned_finish: "2026-03-27",
    calendar_weeks: "11.71",
    working_weeks: "11.4",
    position: "in_progress",
    current_phase: { id: "ph1", code: "A1", name: "Discovery" },
    next_phase: { id: "ph2", code: "A2", name: "Build" },
    next_gate: {
      id: "ph1",
      code: "A1",
      name: "Discovery",
      criteria: "Gate A1",
    },
    forecast_finish: "2026-04-06",
    slip_days: slip,
    phases: PROGRESS.map((p, i) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      state: (["done", "in_progress", "not_started"] as const)[i]!,
      forecast_start: p.actual_start ?? p.planned_start,
      forecast_end: i === 0 ? p.actual_end : "2026-04-06",
      start_slip_days: 0,
      finish_slip_days: i === 0 ? 10 : slip,
    })),
    unavailable: [],
  };
}

const list = (items: unknown[]) => ({
  items,
  total: items.length,
  can_edit: mocks.canEdit,
  degraded: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canEdit = true;
  mocks.estimates = [{ ...ESTIMATE, content: null }];
  mocks.listResource.mockImplementation(async (path: string) => {
    if (path === "estimates") return list(mocks.estimates);
    if (path === "phase-progress") return list(PROGRESS);
    if (path === "milestones") return list([MILESTONE]);
    throw new Error(`unexpected list ${path}`);
  });
  mocks.getResource.mockResolvedValue({ item: ESTIMATE, can_edit: true });
  mocks.fetchForecast.mockResolvedValue(forecast(10));
  mocks.fetchChangeLog.mockResolvedValue({ entries: [], truncated: false });
});

afterEach(cleanup);

const byId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-ui-bridge-id="${id}"]`);

async function shown() {
  render(<TimelinePage />);
  await screen.findByText("Expected to finish");
  await waitFor(() => expect(byId("overview.timeline.list")).not.toBeNull());
}

describe("the header", () => {
  it("words a late finish, and never shows the slip as a signed number", async () => {
    await shown();
    expect(byId("overview.timeline.header.slip")?.textContent).toBe(
      "10 days late"
    );
    expect(byId("overview.timeline.header.now")?.textContent).toContain(
      "A1 Discovery"
    );
    expect(byId("overview.timeline.header.next-gate")?.textContent).toContain(
      "Gate A1"
    );
  });

  it("words an early finish without a minus sign", async () => {
    mocks.fetchForecast.mockResolvedValue(forecast(-5));
    await shown();
    const header = byId("overview.timeline.header")!;
    expect(byId("overview.timeline.header.slip")?.textContent).toBe(
      "5 days early"
    );
    expect(header.textContent).not.toMatch(/[-−]\s?5/);
  });

  it("says what it cannot know instead of a zero", async () => {
    mocks.fetchForecast.mockResolvedValue({
      ...forecast(0),
      forecast_finish: null,
      slip_days: null,
      unavailable: [
        {
          figure: "forecast",
          reason: "phase_dates_missing",
          detail: "No forecast while A2 (Build) has no planned start and end.",
        },
      ],
    });
    await shown();
    expect(byId("overview.timeline.header.forecast")?.textContent).toContain(
      "Not known"
    );
    expect(byId("overview.timeline.header.slip")).toBeNull();
    expect(screen.getByText(/No forecast while A2/)).toBeTruthy();
  });
});

describe("the phases", () => {
  it("draws each phase on the calendar with its gate's outcome", async () => {
    await shown();
    for (const code of ["A0", "A1", "A2"]) {
      expect(byId(`overview.timeline.chart.phase.${code}`)).not.toBeNull();
      expect(byId(`overview.timeline.list.phase.${code}`)).not.toBeNull();
    }
    expect(
      byId("overview.timeline.chart.phase.A0.gate")?.dataset.gateStatus
    ).toBe("passed");
    expect(
      byId("overview.timeline.chart.phase.A1.gate")?.dataset.gateStatus
    ).toBe("pending");
    expect(byId("overview.timeline.chart.today")).not.toBeNull();
    expect(byId("overview.timeline.chart.milestone.m1")).not.toBeNull();
    // The milestone is listed under its phase.
    expect(
      byId("overview.timeline.list.phase.A2.milestones")?.textContent
    ).toContain("Pilot live");
    expect(screen.getAllByText("Critical").length).toBeGreaterThan(0);
  });

  it("shows a gate's criteria and outcome when its marker is chosen", async () => {
    await shown();
    fireEvent.click(byId("overview.timeline.chart.phase.A0.gate")!);
    const panel = byId("overview.timeline.gate-panel")!;
    expect(panel.textContent).toContain("Gate A0");
    expect(panel.textContent).toContain("Passed");
  });
});

describe("a reader", () => {
  it("gets no controls at all", async () => {
    mocks.canEdit = false;
    await shown();
    expect(
      screen.queryByRole("button", { name: "Record progress" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add a milestone" })
    ).toBeNull();
  });
});

describe("recording progress", () => {
  async function openForm(code: string) {
    await shown();
    fireEvent.click(
      byId(`overview.timeline.list.phase.${code}.details.record`)!
    );
    return `overview.timeline.list.phase.${code}.details.form`;
  }

  it("writes only what changed, on the phase's own version", async () => {
    mocks.updateResource.mockResolvedValue({
      ...PROGRESS[1]!,
      gate_status: "passed",
      gate_decided_at: "2026-02-20",
      version: 2,
    });
    const form = await openForm("A1");
    fireEvent.change(byId(`${form}.gate-status`)!, {
      target: { value: "passed" },
    });
    fireEvent.change(byId(`${form}.decided-at`)!, {
      target: { value: "2026-02-20" },
    });
    await act(async () => {
      fireEvent.click(byId(`${form}.save`)!);
    });
    expect(mocks.updateResource).toHaveBeenCalledWith(
      "phase-progress",
      "ph1",
      { gate_status: "passed", gate_decided_at: "2026-02-20" },
      1,
      "ui"
    );
    // The forecast is read again, since progress is what it is made of.
    await waitFor(() => expect(mocks.fetchForecast).toHaveBeenCalledTimes(2));
    expect(byId(`${form}`)).toBeNull();
  });

  it("refuses, before sending, a decided gate with no date", async () => {
    const form = await openForm("A1");
    fireEvent.change(byId(`${form}.gate-status`)!, {
      target: { value: "failed" },
    });
    await act(async () => {
      fireEvent.click(byId(`${form}.save`)!);
    });
    expect(mocks.updateResource).not.toHaveBeenCalled();
    expect(byId(`${form}.error`)?.textContent).toMatch(/decided/);
  });

  it("refuses a finish before the start", async () => {
    const form = await openForm("A1");
    fireEvent.change(byId(`${form}.actual-end`)!, {
      target: { value: "2026-02-01" },
    });
    await act(async () => {
      fireEvent.click(byId(`${form}.save`)!);
    });
    expect(mocks.updateResource).not.toHaveBeenCalled();
    expect(byId(`${form}.error`)?.textContent).toMatch(/before it started/);
  });

  it("makes a peer's save a conflict, then saves mine over theirs knowingly", async () => {
    const theirs = {
      ...PROGRESS[1]!,
      gate_notes: "Theirs",
      version: 2,
      updated_by: "peer@example.com",
      updated_at: "2026-02-20T10:00:00Z",
    };
    mocks.updateResource
      .mockRejectedValueOnce(new VersionConflictError(theirs))
      .mockResolvedValueOnce({ ...theirs, gate_notes: "Mine", version: 3 });
    const form = await openForm("A1");
    fireEvent.change(byId(`${form}.notes`)!, { target: { value: "Mine" } });
    await act(async () => {
      fireEvent.click(byId(`${form}.save`)!);
    });
    const dialog = await screen.findByText(
      "Somebody else changed this while you were editing"
    );
    expect(dialog).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Save mine over theirs" })
      );
    });
    expect(mocks.updateResource).toHaveBeenLastCalledWith(
      "phase-progress",
      "ph1",
      expect.objectContaining({ gate_notes: "Mine" }),
      2,
      "ui"
    );
  });
});

describe("milestones", () => {
  it("adds one through the table as its own create", async () => {
    mocks.createResource.mockResolvedValue({
      ...MILESTONE,
      id: "m2",
      title: "First value",
    });
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "Add a milestone" }));
    const editor = "overview.timeline.milestones.table.editor";
    fireEvent.change(byId(`${editor}.title`)!, {
      target: { value: "First value" },
    });
    fireEvent.change(byId(`${editor}.target_date`)!, {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(byId(`${editor}.kind`)!, {
      target: { value: "first_value" },
    });
    await act(async () => {
      fireEvent.click(byId(`${editor}.done`)!);
    });
    expect(mocks.createResource).toHaveBeenCalledWith(
      "milestones",
      expect.objectContaining({
        title: "First value",
        target_date: "2026-05-01",
        kind: "first_value",
        status: "planned",
        phase_id: null,
      }),
      expect.any(String),
      "ui"
    );
  });

  it("refuses a done milestone with no date without sending it", async () => {
    await shown();
    fireEvent.click(byId("overview.timeline.milestones.table.row.0.edit")!);
    const editor = "overview.timeline.milestones.table.editor";
    fireEvent.change(byId(`${editor}.status`)!, { target: { value: "done" } });
    await act(async () => {
      fireEvent.click(byId(`${editor}.done`)!);
    });
    expect(mocks.updateResource).not.toHaveBeenCalled();
    expect(byId("overview.timeline.milestones.errors")?.textContent).toMatch(
      /date it was done/
    );
  });
});

describe("with no estimate", () => {
  it("says so, and still offers the milestones", async () => {
    mocks.estimates = [];
    render(<TimelinePage />);
    await screen.findByText("This project has no schedule yet");
    expect(byId("overview.timeline.chart")).toBeNull();
    await waitFor(() =>
      expect(byId("overview.timeline.milestones")).not.toBeNull()
    );
    expect(mocks.fetchForecast).not.toHaveBeenCalled();
  });
});

describe("copy as mermaid gantt", () => {
  it("puts the plan on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await shown();
    await act(async () => {
      fireEvent.click(byId("overview.timeline.export.copy")!);
    });
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).toContain("section A1 Discovery");
    expect(text).toMatch(/Interview the sponsors :crit, /);
    expect(text).toMatch(/Pilot live :milestone, /);
  });
});
