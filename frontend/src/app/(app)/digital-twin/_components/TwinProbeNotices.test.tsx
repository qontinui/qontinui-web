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

describe("CoordUnreachableBanner", () => {
  it("shows the operator the transport error", () => {
    render(<CoordUnreachableBanner error={UPSTREAM} />);
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveTextContent(
      "Could not reach the coordination layer: GET /api/v1/digital-twin/subspaces failed: 502 - upstream connect error"
    );
  });

  it("is a labelled UNKNOWN with the HTTP status in presentation mode — never the raw error", () => {
    const view = renderInPresentationMode(
      <CoordUnreachableBanner error={UPSTREAM} />
    );
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveAttribute("data-reading", "unknown");
    expect(el).toHaveTextContent("UNKNOWN");
    expect(el).toHaveTextContent(
      "Coord's live probe could not be read (HTTP 502), so no live status is shown here."
    );
    expect(document.body).not.toHaveTextContent(
      /upstream connect error|\/api\/v1|coordination layer/
    );
    expectPresentationSafe(view);
  });

  it("names no HTTP status when the failure carried none", () => {
    renderInPresentationMode(
      <CoordUnreachableBanner error={new TypeError("Failed to fetch")} />
    );
    const el = notice("digital-twin-coord-unreachable");
    expect(el).toHaveTextContent(
      "Coord's live probe could not be read, so no live status is shown here."
    );
    expect(el).not.toHaveTextContent(/HTTP|Failed to fetch/);
  });
});
