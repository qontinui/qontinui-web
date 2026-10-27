"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchSecretsBrokerDevice,
  putSecretsBrokerDevice,
  type SecretsBrokerDeviceView,
} from "@/lib/api/operations/tenantPolicy";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The backend's typed refusals for a broker-device write, in operator words.
 * The backend answers `{"detail": {"code": …}}`; the message text of a failed
 * `readJson` carries that body, so the code is matched out of it.
 */
const REFUSALS: Record<string, string> = {
  device_not_found: "Coord knows no device with this id.",
  device_not_in_tenant:
    "That device is not bound to this tenant, so it cannot be its secrets broker.",
  device_binding_unknown:
    "Coord could not say which tenants that device is bound to, so nothing was written. Try again once coord answers.",
  coord_secrets_broker_device_route_missing:
    "This coord does not serve the secrets-broker device route yet, so nothing was written.",
  column_not_present:
    "Coord's database does not have the broker-device column yet, so nothing was written.",
  not_coord_tenant_admin: "Only an admin of this tenant can change this.",
  admin_required: "Only an admin of this tenant can change this.",
};

/** The operator-facing words for a failed write, or the raw message. */
export function describeBrokerDeviceRefusal(text: string): string {
  for (const [code, words] of Object.entries(REFUSALS)) {
    if (text.includes(code)) return words;
  }
  return text;
}

/**
 * The tenant's designated secrets-broker device — read what coord resolves,
 * write a new device (or clear it), and show coord's own read-back.
 *
 * Same honesty properties as `useTranscriptSyncPolicy`:
 *
 * 1. What is displayed comes from a READ — the GET, or the backend's post-write
 *    re-read — never from the device we asked for.
 * 2. A write whose re-read failed keeps the last confirmed value and surfaces
 *    `readbackError`; a failed read keeps the last known-good value rather than
 *    blanking it into something that renders as "none designated".
 * 3. A read that started before a landed write is discarded when it resolves.
 */
export function useSecretsBrokerDevice() {
  const [device, setDevice] = useState<SecretsBrokerDeviceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readbackError, setReadbackError] = useState<string | null>(null);
  const writeGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view = await fetchSecretsBrokerDevice();
      if (generation !== writeGeneration.current) return;
      setDevice(view);
      setError(null);
      setReadbackError(null);
    } catch (err) {
      if (generation !== writeGeneration.current) return;
      setError(message(err, "Failed to read the secrets broker device"));
    } finally {
      if (generation === writeGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Retire every read that began before a write that (may have) landed. */
  const supersedeReads = useCallback(() => {
    writeGeneration.current += 1;
    setLoading(false);
  }, []);

  /**
   * Designate `deviceId` as the tenant's broker, or clear it with `null`.
   * Resolves `true` when the write went through (whatever the read-back says).
   */
  const setBrokerDevice = useCallback(
    async (deviceId: string | null) => {
      try {
        setSaving(true);
        const result = await putSecretsBrokerDevice(deviceId);
        supersedeReads();
        if (result.effective) {
          setDevice(result.effective);
          setError(null);
          setReadbackError(null);
          if (
            result.effective.reported &&
            result.effective.device_id === deviceId
          ) {
            toast.success(
              deviceId
                ? "Secrets broker device designated."
                : "Secrets broker device cleared."
            );
          } else {
            toast.warning(
              `Wrote ${deviceId ?? "no device"}, but coord reads it back as ` +
                `${result.effective.reported ? (result.effective.device_id ?? "no device") : "unknown"}.`
            );
          }
        } else {
          setReadbackError(result.readback_error ?? "read-back missing");
          toast.warning(
            "The write went through, but coord did not return what it now " +
              "resolves — refresh to check."
          );
        }
        return true;
      } catch (err) {
        const text = message(err, "Failed to write the secrets broker device");
        // 504: coord's answer was lost in transit and it may have committed.
        if (/ failed: 504\b/.test(text)) {
          supersedeReads();
          setReadbackError(
            "coord's answer was lost in transit, so whether it applied is unknown"
          );
          toast.warning(
            "The write may or may not have been applied — refresh to check."
          );
          return false;
        }
        toast.error(describeBrokerDeviceRefusal(text));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [supersedeReads]
  );

  return {
    device,
    loading,
    saving,
    error,
    readbackError,
    reload: load,
    setBrokerDevice,
  };
}
