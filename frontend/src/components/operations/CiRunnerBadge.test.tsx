import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CiRunnerBadge } from "./CiRunnerBadge";
import type { CiRunnerInfo } from "./types";

/**
 * The label chips and the routing verdict — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 2.
 *
 * The phase's gate is that "a host whose `qontinui` label is absent renders
 * visibly different from one that has it". This file is that gate. The two
 * fixtures are the real pool, measured 2026-08-31: `msi-wsl` carries the
 * routing labels, `spaceship-wsl` here is shown in the delabelled shape a
 * `DELETE .../runners/{id}/labels/qontinui` leaves behind.
 *
 * The second thing under test is the arm that must claim LESS: labels that did
 * not come from coord's GitHub mirror get no routing verdict at all, because a
 * user-paired device's `ci_runner_labels` are not evidence about GitHub.
 */

function renderBadge(ciRunner: CiRunnerInfo) {
  return render(
    <TooltipProvider>
      <CiRunnerBadge ciRunner={ciRunner} />
    </TooltipProvider>
  );
}

const MIRRORED_ROUTABLE: CiRunnerInfo = {
  status: "busy",
  labels: ["self-hosted", "Linux", "X64", "qontinui", "msi"],
  lastJobAt: "2026-08-31T11:00:00Z",
  source: "coord-mirror",
};

const MIRRORED_DELABELLED: CiRunnerInfo = {
  status: "idle",
  labels: ["self-hosted", "Linux", "X64", "spaceship"],
  lastJobAt: null,
  source: "coord-mirror",
};

describe("label chips", () => {
  it("renders every mirrored label", () => {
    const { container } = renderBadge(MIRRORED_ROUTABLE);
    const chips = [...container.querySelectorAll("[data-ci-runner-label]")].map(
      (el) => el.getAttribute("data-ci-runner-label")
    );
    expect(chips).toEqual(["self-hosted", "Linux", "X64", "qontinui", "msi"]);
  });

  it("distinguishes the two ROUTING labels from the decorative ones", () => {
    // `Linux`, `X64` and `msi` do not decide whether GitHub sends work here.
    // Rendering all five identically is what made the delabelled host
    // indistinguishable in the first place.
    const { container } = renderBadge(MIRRORED_ROUTABLE);
    const routing = [
      ...container.querySelectorAll('[data-ci-runner-label-routing="true"]'),
    ].map((el) => el.getAttribute("data-ci-runner-label"));
    expect(routing).toEqual(["self-hosted", "qontinui"]);
  });
});

describe("the routing verdict — the Phase 2 gate", () => {
  it("a host WITH the qontinui label says GitHub matches jobs here", () => {
    const { container } = renderBadge(MIRRORED_ROUTABLE);
    expect(
      container
        .querySelector("[data-ci-runner-routable]")
        ?.getAttribute("data-ci-runner-routable")
    ).toBe("yes");
    expect(screen.getByTestId("ci-runner-routable")).toBeTruthy();
    expect(screen.queryByTestId("ci-runner-not-routable")).toBeNull();
  });

  it("a host WITHOUT it renders visibly different, and names what is missing", () => {
    const { container } = renderBadge(MIRRORED_DELABELLED);
    expect(
      container
        .querySelector("[data-ci-runner-routable]")
        ?.getAttribute("data-ci-runner-routable")
    ).toBe("no");
    const notice = screen.getByTestId("ci-runner-not-routable");
    expect(notice.textContent).toMatch(/GitHub will not route fleet CI here/);
    expect(notice.textContent).toContain("qontinui");
    expect(screen.queryByTestId("ci-runner-routable")).toBeNull();
  });

  it("makes NO routing claim for labels that did not come from the mirror", () => {
    const { container } = renderBadge({
      status: "idle",
      labels: ["self-hosted"],
      lastJobAt: null,
      source: "device-registry",
    });
    expect(
      container
        .querySelector("[data-ci-runner-routable]")
        ?.getAttribute("data-ci-runner-routable")
    ).toBe("unknown");
    expect(screen.queryByTestId("ci-runner-not-routable")).toBeNull();
    expect(screen.queryByTestId("ci-runner-routable")).toBeNull();
  });

  it("treats a row with no declared source as the arm that claims less", () => {
    const { container } = renderBadge({
      status: "idle",
      labels: ["self-hosted", "qontinui"],
      lastJobAt: null,
    });
    expect(
      container
        .querySelector("[data-ci-runner-routable]")
        ?.getAttribute("data-ci-runner-routable")
    ).toBe("unknown");
  });
});

describe("status", () => {
  it("renders an unknown status as unknown, not as offline", () => {
    renderBadge({ ...MIRRORED_ROUTABLE, status: "unknown" });
    expect(screen.getByText("CI Runner: status unknown")).toBeTruthy();
  });
});
