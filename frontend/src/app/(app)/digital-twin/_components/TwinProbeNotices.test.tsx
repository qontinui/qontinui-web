/**
 * The two notices every view of the sub-space probe shares, in both modes
 * (plan `2026-10-23-console-presentation-spaces` Phase 5): the operator is
 * told what happened and what to do; an outsider is shown a labelled UNKNOWN
 * naming why there is no reading — never an access decision dressed as data
 * about the product, and never a raw transport error.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type { ProbeRead } from "../_lib/probe-read";
import { RESTRICTED_REASON } from "../_lib/twin-aspects";
import {
  CoordUnreachableBanner,
  TwinAccessRestricted,
} from "./TwinProbeNotices";

const UPSTREAM = new Error(
  "GET /api/v1/digital-twin/subspaces failed: 502 - upstream connect error"
);

function notice(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

describe("TwinAccessRestricted", () => {
  it("tells the operator the twin is restricted, and who to ask", () => {
    render(<TwinAccessRestricted />);
    const el = notice("digital-twin-access-restricted");
    expect(el).toHaveTextContent("Access restricted");
    expect(el).toHaveTextContent(/limited to internal Qontinui operators/);
    expect(el).not.toHaveAttribute("data-reading");
  });

  it("is a labelled UNKNOWN naming the restriction in presentation mode", () => {
    const view = renderInPresentationMode(<TwinAccessRestricted />);
    const el = notice("digital-twin-access-restricted");
    expect(el).toHaveAttribute("data-reading", "unknown");
    expect(el).toHaveTextContent("UNKNOWN");
    // The reason, sentence-cased, then what its absence means here.
    expect(el).toHaveTextContent(
      `${RESTRICTED_REASON.charAt(0).toUpperCase()}${RESTRICTED_REASON.slice(1)}, so no live status is shown here.`
    );
    expect(document.body).not.toHaveTextContent(
      /Access restricted|internal Qontinui operators|ask an administrator/
    );
    expectPresentationSafe(view);
  });
});

/** A probe read in one of the ways the banner speaks to. */
function probe(over: Partial<ProbeRead> = {}): ProbeRead {
  return {
    rows: [],
    failed: false,
    refreshFailed: false,
    error: null,
    degraded: null,
    unanswered: null,
    restricted: false,
    asOf: null,
    failedAt: null,
    ...over,
  };
}

const OFFLINE = "coord's live probe has not answered: this browser is offline";

const FAILED = probe({ failed: true, error: UPSTREAM });
const DEGRADED =
  "coord's live probe could not be made: coord could not be reached";

describe("CoordUnreachableBanner", () => {
  it("shows the operator the transport error, and that no live count or cell is a reading", () => {
    render(<CoordUnreachableBanner probe={FAILED} />);
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveTextContent(
      "Could not reach the coordination layer: GET /api/v1/digital-twin/subspaces failed: 502 - upstream connect error. No probe has answered, so every live count and cell below is UNKNOWN; the taxonomy below is still accurate."
    );
  });

  it("tells the operator a failed refresh leaves the last answer's statuses", () => {
    render(
      <CoordUnreachableBanner
        probe={probe({ refreshFailed: true, error: UPSTREAM })}
      />
    );
    expect(notice("digital-twin-coord-unreachable")).toHaveTextContent(
      "Live cells fall back to their last status; the taxonomy below is still accurate."
    );
  });

  it("renders nothing while the probe holds a current reading", () => {
    const { container } = render(<CoordUnreachableBanner probe={probe()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled UNKNOWN with the HTTP status in presentation mode — never the raw error", () => {
    const view = renderInPresentationMode(
      <CoordUnreachableBanner probe={FAILED} />
    );
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveAttribute("data-reading", "unknown");
    expect(el).toHaveTextContent("UNKNOWN");
    // The view still renders below the notice, so it says what that is —
    // not that nothing live is shown.
    expect(el).toHaveTextContent(
      "Coord's live probe could not be read (HTTP 502), so the live statuses below are not a current reading."
    );
    expect(document.body).not.toHaveTextContent(
      /upstream connect error|\/api\/v1|coordination layer/
    );
    expectPresentationSafe(view);
  });

  it("names no HTTP status when the failure carried none", () => {
    renderInPresentationMode(
      <CoordUnreachableBanner
        probe={probe({ failed: true, error: new TypeError("Failed to fetch") })}
      />
    );
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveTextContent(
      "Coord's live probe could not be read, so the live statuses below are not a current reading."
    );
    expect(el).not.toHaveTextContent(/HTTP|Failed to fetch/);
  });

  it("tells the operator a degraded answer made no probe, so its counts and cells are UNKNOWN", () => {
    render(<CoordUnreachableBanner probe={probe({ degraded: DEGRADED })} />);
    expect(notice("digital-twin-coord-unreachable")).toHaveTextContent(
      "Coord's live probe could not be made: coord could not be reached. coord made no probe, so every live count and cell below is UNKNOWN; the taxonomy below is still accurate."
    );
  });

  it("names a degraded answer's cause as the UNKNOWN in presentation mode", () => {
    const view = renderInPresentationMode(
      <CoordUnreachableBanner probe={probe({ degraded: DEGRADED })} />
    );
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveAttribute("data-reading", "unknown");
    expect(el).toHaveTextContent(
      "Coord's live probe could not be made: coord could not be reached, so the live statuses below are not a current reading."
    );
    expectPresentationSafe(view);
  });

  it("tells the operator a held read has no answer, so its counts and cells are UNKNOWN — with no transport error to quote", () => {
    render(<CoordUnreachableBanner probe={probe({ unanswered: OFFLINE })} />);
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveTextContent(
      "Coord's live probe has not answered: this browser is offline, so every live count and cell below is UNKNOWN; the taxonomy below is still accurate."
    );
    // Nothing reached coord: no "fall back to their last status".
    expect(el).not.toHaveTextContent(/coordination layer|last status/);
  });

  it("names a held read's cause as the UNKNOWN in presentation mode", () => {
    const view = renderInPresentationMode(
      <CoordUnreachableBanner probe={probe({ unanswered: OFFLINE })} />
    );
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveAttribute("data-reading", "unknown");
    expect(el).toHaveTextContent(
      "Coord's live probe has not answered: this browser is offline, so the live statuses below are not a current reading."
    );
    expectPresentationSafe(view);
  });
});
