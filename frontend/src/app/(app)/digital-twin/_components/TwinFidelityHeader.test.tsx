/**
 * The Completeness tab's "Twin self-fidelity" header says UNKNOWN until coord
 * serves the report — never a zero that was never measured — says
 * "Qontinui-internal" to a tenant coord refuses, and shows the report's
 * numbers (with `null` fields UNKNOWN) once one is served. In presentation
 * mode (plan `2026-10-23-console-presentation-spaces`) the refusal is a
 * labelled UNKNOWN naming why — an outsider must not read an access decision
 * as a fact about the product — and the numbers carry their source and age.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import { SELF_CHECK_INTERNAL_REASON } from "../_lib/twin-aspects";
import type { RawVerdictResponse } from "../_lib/types";

const state = vi.hoisted(() => ({
  raw: {
    data: undefined as RawVerdictResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    errorUpdatedAt: 0,
  },
  /** The sub-space id the header asked for. */
  askedFor: [] as (string | null)[],
}));

vi.mock("../_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: (id: string | null) => {
    state.askedFor.push(id);
    return state.raw;
  },
}));

import { TwinFidelityHeader } from "./TwinFidelityHeader";

/** When a failed read was attempted (the query's `errorUpdatedAt`). */
const FAILED_AT = Date.parse("2026-10-23T11:59:00Z");

function failWith(status: number) {
  state.raw = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error(
      `GET /api/v1/digital-twin/subspace/twin_fidelity/raw failed: ${status} - {}`
    ),
    errorUpdatedAt: FAILED_AT,
  };
}

function header(): HTMLElement {
  return screen.getByTestId("digital-twin-fidelity-header");
}

beforeEach(() => {
  state.raw = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    errorUpdatedAt: 0,
  };
  state.askedFor = [];
});

describe("TwinFidelityHeader", () => {
  it("reads the twin_fidelity sub-space's raw verdict", () => {
    render(<TwinFidelityHeader />);
    expect(state.askedFor).toContain("twin_fidelity");
    expect(header()).toHaveTextContent("Twin self-fidelity");
  });

  it("says UNKNOWN, with no number, while coord serves no fidelity read (404)", () => {
    failWith(404);
    render(<TwinFidelityHeader />);
    expect(header()).toHaveTextContent("UNKNOWN");
    expect(header()).toHaveTextContent(
      "coord serves no twin-fidelity read on the twin door yet"
    );
    expect(header().textContent).not.toMatch(/\d+%/);
  });

  it("says UNKNOWN when coord answers with no report", () => {
    state.raw = {
      data: {
        subspace: "twin_fidelity",
        tool: "coord_query_twin_fidelity",
        verdict: { observed: false, reason: "the fidelity watcher is off" },
      },
      isLoading: false,
      isError: false,
      error: null,
      errorUpdatedAt: 0,
    };
    render(<TwinFidelityHeader />);
    expect(header()).toHaveTextContent("UNKNOWN");
    expect(header()).toHaveTextContent("the fidelity watcher is off");
  });

  it("says Qontinui-internal to a tenant coord refuses (403)", () => {
    failWith(403);
    render(<TwinFidelityHeader />);
    expect(header()).toHaveTextContent("Qontinui-internal");
    expect(header()).not.toHaveTextContent("UNKNOWN");
  });

  it("shows the report's numbers, its age, and UNKNOWN for an unsampled field", () => {
    state.raw = {
      data: {
        subspace: "twin_fidelity",
        tool: "coord_query_twin_fidelity",
        verdict: {
          total: 13,
          observed_count: 10,
          blind_count: 3,
          honesty_violations: 2,
          stale_evidence_violations: 1,
          stale_at_decision_violations: null,
          observability_rate: 0.77,
          age_seconds: 120,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      errorUpdatedAt: 0,
    };
    render(<TwinFidelityHeader />);
    const el = header();
    // Each stat is a dt (label) then a dd (value) in DOM order.
    expect(el).toHaveTextContent("observability rate77%");
    expect(el).toHaveTextContent("blind sub-spaces3");
    expect(el).toHaveTextContent("honesty violations2");
    expect(el).toHaveTextContent("stale evidence1");
    // Phase 4b serves an unsampled decision class as null, never 0.
    expect(el).toHaveTextContent("stale at decisionUNKNOWN");
    expect(el).toHaveTextContent("report 2m old");
  });
});

describe("TwinFidelityHeader in presentation mode", () => {
  it("names a refused report (403) as a labelled UNKNOWN — never the Qontinui-internal notice", () => {
    failWith(403);
    const view = renderInPresentationMode(<TwinFidelityHeader />);
    expect(header()).toHaveTextContent("UNKNOWN");
    expect(header()).toHaveTextContent(SELF_CHECK_INTERNAL_REASON);
    expect(header()).not.toHaveTextContent(
      /Qontinui-internal|readable only by Qontinui/
    );
    // The UNKNOWN carries where it was sought and when the attempt was made.
    const chip = header().querySelector("[data-provenance]");
    expect(chip).toHaveTextContent("source: coord's twin self-check");
    expect(chip).toHaveAttribute("data-provenance-known", "true");
    expectPresentationSafe(view);
  });

  it("puts the report's source and computed-at time beside its numbers", () => {
    state.raw = {
      data: {
        subspace: "twin_fidelity",
        tool: "coord_query_twin_fidelity",
        verdict: {
          total: 13,
          observed_count: 10,
          blind_count: 3,
          honesty_violations: 0,
          stale_evidence_violations: 0,
          stale_at_decision_violations: 0,
          observability_rate: 0.77,
          computed_at: "2026-10-23T11:50:00Z",
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      errorUpdatedAt: 0,
    };
    const view = renderInPresentationMode(<TwinFidelityHeader />);
    expect(header()).toHaveTextContent("observability rate77%");
    const chip = header().querySelector("[data-provenance]");
    expect(chip).toHaveTextContent("source: coord's twin self-check");
    expect(chip).toHaveAttribute("data-provenance-known", "true");
    expect(chip?.getAttribute("title")).toMatch(/As of .*2026/);
    expectPresentationSafe(view);
  });

  it("says UNKNOWN for a report coord does not serve, with no number", () => {
    failWith(404);
    const view = renderInPresentationMode(<TwinFidelityHeader />);
    expect(header()).toHaveTextContent("UNKNOWN");
    expect(header().textContent).not.toMatch(/\d+%/);
    expectPresentationSafe(view);
  });
});
