/**
 * The app registry panel's own presentation guards (plan
 * `2026-10-23-console-presentation-spaces` D3.3), driven on the panel itself.
 *
 * The page never hands this panel a registry while presenting: neither
 * registry is partitioned by project, so neither is read then
 * (`appRegistryReadsOf`, pinned in `page.presentation.test.tsx`). These guards
 * are the panel's second line — should a caller hand it rows while presenting
 * anyway, every row is expanded and checked: an app's id, another app's name,
 * its local checkout path and URL, and the web backend's own refusal stay with
 * the operator, and the runner's own app is named.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type { RegisteredApp } from "@/app/(app)/digital-twin/_lib/ui-bridge-types";
import { BUILD_ID, FLEET_APPS, GIT_SHA } from "../__fixtures__/runnerBodies";
import type { RegistryRead, WebAppConfig } from "../_lib/appRegistryStatus";
import { AppRegistryPanel } from "./AppRegistryPanel";

const SCOPE = {
  status: "ready" as const,
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Partner A"] },
};

const BUILD = { state: "known", buildId: BUILD_ID, gitSha: GIT_SHA } as const;

/** What a runner's own `GET /apps` would list, were a relay to carry it. */
const RUNNER_APPS: RegisteredApp[] = [
  {
    app_id: "qontinui-runner",
    display_name: "Qontinui Runner",
    repo_root: "/home/dev/src/qontinui-runner",
    ui_bridge_url: "http://127.0.0.1:1420",
    last_seen_at_ms: 1761200000000,
  },
  {
    app_id: "acme-portal",
    display_name: "Acme Portal",
    repo_root: "/home/dev/src/acme-portal",
    ui_bridge_url: "http://127.0.0.1:5173",
    last_seen_at_ms: 1761200000000,
  },
];

const ok = <T,>(value: T): RegistryRead<T> => ({
  state: "ok",
  value,
  stale: false,
  asOf: 1761210000000,
});

/** Everything an app row or its detail holds that the lens must not show. */
const FORBIDDEN = [
  "example-portal",
  "Example Portal",
  "acme-portal",
  "Acme Portal",
  "/home/dev/src",
  "127.0.0.1",
];

describe("the app registry panel handed rows while presenting", () => {
  it("names only the runner's own app, and keeps every id, path and URL to the operator — every row expanded", () => {
    const view = renderInPresentationMode(
      <AppRegistryPanel
        web={ok<readonly WebAppConfig[]>(FLEET_APPS)}
        webError={null}
        runner={ok<readonly RegisteredApp[]>(RUNNER_APPS)}
        build={BUILD}
      />,
      { scope: SCOPE }
    );
    const rows = screen.getAllByTestId("coord-ui-bridge-app-row");
    expect(rows).toHaveLength(3);
    expect(
      rows.some((r) => within(r).queryByText("Qontinui Runner") !== null)
    ).toBe(true);
    for (const row of rows) {
      fireEvent.click(within(row).getAllByRole("button")[0]);
      expect(within(row).getByText(/^Update strategy: /)).toBeInTheDocument();
      expectPresentationSafe(view, { forbidden: FORBIDDEN });
    }
  });

  it("leaves the web backend's own refusal out, keeping the registry's UNKNOWN", () => {
    const view = renderInPresentationMode(
      <AppRegistryPanel
        web={{
          state: "failed",
          issue: { kind: "failed", cause: null, requestId: null, quotes: true },
        }}
        webError={new Error("GET /api/v1/fleet/apps failed: 500 - boom")}
        runner={{ state: "not-read", reason: "not read" }}
        build={BUILD}
      />,
      { scope: SCOPE }
    );
    const unknown = screen.getByTestId("coord-ui-bridge-apps-web-unknown");
    expect(unknown).toHaveTextContent(
      "UNKNOWNThe web's app registry could not be read."
    );
    expectPresentationSafe(view, { forbidden: ["boom"] });
  });
});
