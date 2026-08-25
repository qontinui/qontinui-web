"use client";

/**
 * `GET /api/v1/devenv/machines` — the devenv machine roster, read once so the
 * Dev Ops page can join its coord-device rows to the machine records
 * `CiNodeConfigPanel` is keyed on (plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 2).
 *
 * ## What this hook is, and what it is deliberately not
 *
 * It reads the JOIN — the `id`/`coord_device_id` pairing — and nothing else.
 * It does **not** read, cache or default any CI-node configuration: that is
 * `CiNodeConfigPanel`'s own `getCiNodeConfig` / `setCiNodeConfig`, called from
 * inside the one shared component, so both mount points hit the same two
 * functions and there is exactly one implementation to keep honest.
 *
 * ## Why it does not poll
 *
 * The roster changes when somebody enrols, revokes or deletes a machine — an
 * operator action taken on another page — not on a telemetry cadence. The two
 * genuinely live reads on this page (fleet health at 10 s, resource samples at
 * 30 s) are live because the facts they carry change by themselves. A third
 * poll here would add request volume and a third chance to disagree about the
 * fleet, and would still not be live with respect to another tab. A machine
 * enrolled while this page is open therefore appears on the next load; the
 * unlinked row says where to go and links there.
 *
 * Every failure lands on `unavailable` WITH the reason. A failed read must
 * never degrade into "no machine is linked to this device", which is a claim
 * about the device rather than about the request
 * (`[policy: silent-empty-is-unknown]`).
 */

import { useEffect, useState } from "react";
import { listMachines } from "@/services/devenv-api";
import {
  indexMachinesByCoordDevice,
  type DevenvMachinesRead,
} from "./ciCapacity";

const LOADING: DevenvMachinesRead = { state: "loading" };

export function useDevenvMachines(): DevenvMachinesRead {
  const [read, setRead] = useState<DevenvMachinesRead>(LOADING);

  useEffect(() => {
    let live = true;
    listMachines()
      .then((machines) => {
        if (!live) return;
        // A body that is not a list cannot be indexed, and pretending it
        // indexed to nothing would report "no machines linked".
        if (!Array.isArray(machines)) {
          setRead({
            state: "unavailable",
            reason:
              "The machine list did not come back as a list, so no machine " +
              "record could be matched to a device.",
          });
          return;
        }
        setRead({
          state: "ok",
          byCoordDevice: indexMachinesByCoordDevice(machines),
        });
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRead({
          state: "unavailable",
          reason:
            err instanceof Error
              ? `The machine list could not be read: ${err.message}`
              : "The machine list could not be read.",
        });
      });
    return () => {
      live = false;
    };
  }, []);

  return read;
}
