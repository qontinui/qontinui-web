"use client";

/**
 * TelemetryBeaconInit — mounts the Ξ_ClientTelemetry beacon once on the client.
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md (§3, §3.6)
 *
 * ⚠️  COUNSEL-REVIEW GATE: this is a pure NO-OP unless
 * ``NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED === "1"`` (unset by default). The
 * enable decision lives entirely inside ``installBeacon`` — when the flag is
 * off it installs no listeners and sends nothing, so mounting this component in
 * the root layout has zero effect until counsel clears the live rollout (LIA /
 * DPIA-lite + DPA where EU/UK users exist). See ``beacon.ts`` header.
 *
 * Mounted as a sibling of ``DevDebugInit`` / ``SpecCiInit`` in the root layout.
 */

import { useEffect } from "react";

import { installBeacon } from "@/lib/telemetry/beacon";

export function TelemetryBeaconInit() {
  useEffect(() => {
    // installBeacon() is internally gated (flag + GPC/DNT + SSR guard) and
    // idempotent. When disabled it returns immediately without side effects.
    installBeacon();
    // Intentionally NOT uninstalling on unmount: the root layout mounts once
    // for the app's lifetime, and the beacon must survive route changes to keep
    // observing. (uninstallBeacon exists for tests / hot-reload only.)
  }, []);

  return null;
}
