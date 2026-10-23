/**
 * `DeviceDrainControl` in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7, D3.2 and D3.3).
 *
 * An outsider sees whether the machine is in service, for every state the
 * read can be in, and nothing else: no lever, no dialog, no target line (the
 * coord hostname and device id), no "drained by" and no reason. The block is
 * `device-drain-status`, never the operator's `device-drain`.
 */

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
// An admin: the lever WOULD render for the operator, so its absence here is
// presentation mode's doing, not the auth gate's.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

import { DeviceDrainControl } from "./DeviceDrainControl";
import {
  parseFleetDrain,
  resolveDeviceDrain,
  type DeviceDrainState,
  type DrainTarget,
} from "./fleetDrain";

const DEVICE = "11111111-2222-3333-4444-555555555555";
const COORD_HOST = "gh-runner-private-box-77";
const ROW_HOST = "private-box-77";
const NOW = Date.parse("2026-09-01T12:00:00Z");

const IDENTIFIED: DrainTarget = {
  state: "identified",
  deviceId: DEVICE,
  coordHostname: COORD_HOST,
};

function drainState(until: string): DeviceDrainState {
  return resolveDeviceDrain(
    parseFleetDrain({
      drained: {
        [DEVICE]: {
          until,
          reason: "rebuild for Acme Corp",
          drained_by: "operator@example.com",
          drained_at: "2026-09-01T11:00:00Z",
        },
      },
    }),
    DEVICE,
    NOW
  );
}

const CASES: Array<{
  name: string;
  target: DrainTarget;
  drain: DeviceDrainState;
  key: string;
  says: RegExp;
}> = [
  {
    name: "drained",
    target: IDENTIFIED,
    drain: drainState("2026-09-01T18:00:00Z"),
    key: "drained",
    says: /out of service[\s\S]*drained until/i,
  },
  {
    name: "expired",
    target: IDENTIFIED,
    drain: drainState("2026-09-01T11:30:00Z"),
    key: "expired",
    says: /back in service/i,
  },
  {
    name: "not drained",
    target: IDENTIFIED,
    drain: { state: "not_drained" },
    key: "not_drained",
    says: /in service — new work may be sent to it/i,
  },
  {
    name: "unknown",
    target: IDENTIFIED,
    drain: {
      state: "unknown",
      reason: "Coord's drain state is still being read.",
    },
    key: "unknown",
    says: /drain state unknown[\s\S]*may or may not be taking new work/i,
  },
  {
    name: "no coord device",
    target: { state: "no_device", reason: "no device row" },
    drain: { state: "not_drained" },
    key: "no_device",
    says: /no drain state/i,
  },
];

describe("DeviceDrainControl in presentation mode", () => {
  for (const c of CASES) {
    it(`${c.name}: states the drain read-only, with no lever, no target and no actor`, () => {
      const view = renderInPresentationMode(
        <DeviceDrainControl
          target={c.target}
          drain={c.drain}
          rowHostname={ROW_HOST}
          now={NOW}
        />
      );

      const status = screen.getByTestId("device-drain-status");
      expect(status).toHaveAttribute("data-device-drain", c.key);
      expect(status).toHaveTextContent(c.says);

      for (const testId of [
        "device-drain",
        "device-drain-open",
        "device-drain-undrain",
        "device-drain-dialog",
        "device-drain-target",
        "device-drain-disabled-reason",
      ]) {
        expect(screen.queryByTestId(testId), testId).toBeNull();
      }
      expect(screen.queryByRole("button")).toBeNull();

      const html = document.body.innerHTML;
      for (const secret of [
        DEVICE,
        COORD_HOST,
        ROW_HOST,
        "operator@example.com",
        "Acme",
      ]) {
        expect(html, secret).not.toContain(secret);
      }

      expectPresentationSafe(view);
    });
  }
});
