import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { bodyText, plainLanguageViolations } from "../../_lib/plain-language";
import {
  envelope,
  known,
  milestone,
  noProgrammeEnvelope,
  phase,
  unknown,
  unreachableEnvelope,
} from "../../_lib/schedule-fixtures";
import type { GateView } from "../../_lib/schedule-api";
import { ScheduleSection } from "./ScheduleSection";

afterEach(cleanup);

const TODAY = new Date(2026, 10, 25);

const byId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-ui-bridge-id="${id}"]`);

function show(env = envelope()) {
  return render(<ScheduleSection env={env} today={TODAY} />);
}

describe("a derived schedule", () => {
  it("draws every phase and the milestone lane, with each state in plain words", () => {
    show();
    for (const code of ["F1", "F2", "F3"]) {
      expect(byId(`overview.schedule.chart.phase.${code}`)).not.toBeNull();
      expect(byId(`overview.schedule.list.phase.${code}`)).not.toBeNull();
    }
    expect(byId("overview.schedule.chart.phase.F1.state")?.textContent).toBe(
      "Done"
    );
    expect(byId("overview.schedule.chart.phase.F2.state")?.textContent).toBe(
      "In progress"
    );
    // Coord holds nothing either way for F3: "Not confirmed", never "Planned".
    expect(byId("overview.schedule.chart.phase.F3.state")?.textContent).toBe(
      "Not confirmed"
    );
    expect(byId("overview.schedule.chart.phases")).toBeNull();
    expect(
      document.querySelectorAll(
        "[data-ui-bridge-id^='overview.schedule.chart.milestone.']"
      )
    ).toHaveLength(2);
  });

  it("a done phase with no recorded dates says so and draws no bar for it", () => {
    show();
    expect(byId("overview.schedule.chart.phase.F1.bar")).toBeNull();
    expect(byId("overview.schedule.chart.phase.F1.dates")?.textContent).toMatch(
      /Not available.*it was not recorded/
    );
    // The phase with a recorded start does draw one, running to today.
    expect(byId("overview.schedule.chart.phase.F2.bar")).not.toBeNull();
  });

  it("shows the milestone dates, 'not confirmed' for an unlinked one", () => {
    show();
    const list = byId("overview.schedule.milestones.list")!;
    expect(list.textContent).toContain("Launch review");
    expect(list.textContent).toContain("1 Dec 2026");
    expect(list.textContent).toContain("Not confirmed");
  });

  it("with no decision gate recorded says so", () => {
    show();
    expect(byId("overview.schedule.gates.none")?.textContent).toBe(
      "No decision gates are recorded for this project."
    );
  });

  it("words a gate's verdict for a person", () => {
    const gates: GateView[] = [
      {
        id: "g1",
        title: "Customer showing accepted",
        verdict: "pending",
        decided_at: null,
        unit_slug: null,
      },
      {
        id: "g2",
        title: "Security review",
        verdict: "passed",
        decided_at: "2026-11-10T09:00:00Z",
        unit_slug: null,
      },
      {
        id: "g3",
        title: "Budget release",
        verdict: "failed",
        decided_at: "2026-11-12T09:00:00Z",
        unit_slug: null,
      },
    ];
    const base = envelope();
    show({ ...base, gates: { ...base.gates, items: known(gates) } });
    const text = (i: number) =>
      byId(`overview.schedule.gates.item.${i}`)!.textContent;
    expect(text(0)).toContain("Waiting for a decision");
    expect(text(1)).toContain("Approved");
    expect(text(1)).toContain("10 Nov 2026");
    expect(text(2)).toContain("Not approved");
  });

  it("an unreadable milestone row is listed, not dropped", () => {
    const base = envelope();
    show({
      ...base,
      milestones: { ...base.milestones, unreadable_rows: ["| ?? | ?? |"] },
    });
    expect(
      byId("overview.schedule.milestones.list.unreadable")?.textContent
    ).toContain("| ?? | ?? |");
  });
});

describe("an unknown schedule", () => {
  it("every figure reads Not available since, the chart draws no bars, and nothing is defaulted", () => {
    const { container } = show(unreachableEnvelope());
    const text = bodyText(container);
    expect(text).toContain("Not available since 21 Nov 2026");
    expect(text).toContain("the project record could not be reached");
    expect(
      document.querySelectorAll("[data-unknown='true']").length
    ).toBeGreaterThan(3);
    expect(byId("overview.schedule.chart")).toBeNull();
    expect(byId("overview.schedule.list")).toBeNull();
    expect(byId("overview.schedule.gates.none")).toBeNull();
    // The forbidden defaults.
    expect(text).not.toMatch(/\b0 days?\b/);
    expect(text).not.toMatch(/On track/i);
    expect(text).not.toMatch(/Planned/);
    expect(text).not.toMatch(/No decision gates/);
  });

  it("a failed read is not an empty list: phases unknown never says 'no phases'", () => {
    show(unreachableEnvelope());
    expect(bodyText(document.body)).not.toMatch(/declares no phases/);
  });

  it("a project with no programme says the phases are not available for that reason", () => {
    show(noProgrammeEnvelope());
    expect(byId("overview.schedule.phases.unknown")?.textContent).toContain(
      "no delivery programme is recorded"
    );
  });

  it("the forecast without dates is 'Not available', never a slip", () => {
    show();
    const f = byId("overview.schedule.header.forecast")!;
    expect(f.textContent).toContain("Not available");
    expect(f.textContent).toContain("no planned dates");
    expect(byId("overview.schedule.header.forecast.slip")).toBeNull();
  });

  it("a stale read says it may be out of date and keeps its old time", () => {
    show(envelope({ stale: true, observed_at: "2026-11-25T11:50:00Z" }));
    expect(byId("overview.schedule.provenance.line")?.textContent).toMatch(
      /Last read from the project record at .*may be out of date/
    );
  });
});

describe("the header", () => {
  it("when no phase has a confirmed state it does not headline '0 of N phases done'", () => {
    show(
      envelope({ phases: known([phase(1, "F1", "F1"), phase(2, "F2", "F2")]) })
    );
    const now = byId("overview.schedule.header.now")!;
    expect(now.textContent).not.toMatch(/0 of 2 phases done/);
    expect(now.textContent).toContain("Not confirmed");
    expect(now.textContent).toContain("2 of 2 phases have no confirmed state");
  });

  it("renders no U+FFFD anywhere, even for an unknown milestone status", () => {
    const base = envelope();
    const item = milestone("Review", "2026-12-01", "met", {
      status: unknown("coord_unreachable", "2026-11-21T10:00:00Z"),
    });
    const { container } = show({
      ...base,
      milestones: { ...base.milestones, items: known([item]) },
    });
    expect(container.textContent).toContain("Not available since 21 Nov 2026");
    expect(container.textContent).not.toContain(String.fromCharCode(0xfffd));
  });

  it("names the phase under way, and the next date", () => {
    show(envelope());
    expect(byId("overview.schedule.header.now")?.textContent).toContain(
      "F2 First release"
    );
    expect(byId("overview.schedule.header.next")?.textContent).toContain(
      "1 Dec 2026"
    );
    expect(byId("overview.schedule.header.disagreements")).toBeNull();
  });

  it("with a forecast, words the slip", () => {
    const base = envelope();
    show({
      ...base,
      forecast: known({
        planned_finish: "2027-01-22",
        forecast_finish: "2027-02-12",
        slip_days: 21,
        position: "in_progress",
        current_phase: { code: "F2", name: "First release" },
        next_phase: null,
      }),
    });
    expect(byId("overview.schedule.header.forecast.slip")?.textContent).toBe(
      "3 weeks late"
    );
  });
});

describe("plain language (D6)", () => {
  it("the rendered body holds no identifier or raw state name", () => {
    const { container } = show(
      envelope({
        gates: {
          ...envelope().gates,
          items: known<GateView[]>(
            [
              {
                id: "9f8e7d6c-1111-2222-3333-444455556666",
                title: "Customer showing accepted",
                verdict: "pending",
                decided_at: null,
                unit_slug: "delivery-programme",
              },
            ],
            "coord_gates"
          ),
        },
      })
    );
    // The gate's id is on the page, but only inside the disclosure.
    expect(container.textContent).toContain("9f8e7d6c-");
    expect(plainLanguageViolations(container)).toEqual([]);
  });

  it("FAILS on a planted in_progress", () => {
    const { container } = render(
      <div>
        <p>Phase F2 is in_progress</p>
      </div>
    );
    expect(plainLanguageViolations(container)).toContain("in_progress");
  });

  it("FAILS on a planted uuid, a PR number and a work-unit", () => {
    const { container } = render(
      <div>
        <p>Gate 0a1b2c3d-0000-4000-8000-000000000000 for #123 on work-unit x</p>
      </div>
    );
    expect(plainLanguageViolations(container).sort()).toEqual(
      ["pull request number", "uuid prefix", "work-unit"].sort()
    );
  });

  it("a planted identifier inside the disclosure is exempt, outside it is not", () => {
    const { container } = render(
      <div>
        <p>All clear</p>
        <details data-provenance-detail>
          <summary>Where this comes from</summary>in_progress 0a1b2c3d-
        </details>
      </div>
    );
    expect(plainLanguageViolations(container)).toEqual([]);
    const planted = render(
      <div>
        <details data-provenance-detail>in_progress</details>
        <p>in_progress</p>
      </div>
    );
    expect(plainLanguageViolations(planted.container)).toEqual(["in_progress"]);
  });
});

describe("as a report block would place it", () => {
  it("a coord-derived phase renders with its provenance line", () => {
    render(
      <ScheduleSection
        env={envelope({
          phases: known([
            phase(1, "F2", "F2 First release", {
              state: "in_progress",
              actual_start: known("2026-11-02"),
            }),
          ]),
          milestones: {
            items: known([milestone("Pilot go-live", "2026-12-18")]),
            unreadable_rows: [],
          },
          observed_at: "2026-11-25T14:03:00Z",
        })}
        today={TODAY}
      />
    );
    expect(screen.getAllByText(/F2 First release/).length).toBeGreaterThan(0);
    expect(byId("overview.schedule.provenance.line")?.textContent).toMatch(
      /^From the project record, as of \d\d:\d\d\.$/
    );
    expect(
      byId("overview.schedule.provenance.disclosure")?.textContent
    ).toContain("Where this comes from");
  });
});

// An unknown figure is one component: this guards that it is the thing used.
describe("unknown figures share one component", () => {
  it("a phase whose end is unknown uses UnknownFigure's marker", () => {
    show(
      envelope({
        phases: known([
          phase(1, "F2", "F2", {
            state: "done",
            actual_start: known("2026-11-02"),
            actual_end: unknown("ship_retracted", "2026-11-24T00:00:00Z"),
          }),
        ]),
      })
    );
    const end = byId("overview.schedule.chart.phase.F2.end");
    expect(end?.dataset.unknown).toBe("true");
    expect(end?.dataset.unknownReason).toBe("ship_retracted");
    expect(end?.textContent).toContain("Not available since 24 Nov 2026");
  });
});
