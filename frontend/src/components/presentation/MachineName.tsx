"use client";

/**
 * MachineName / useMachineName / useMachineAliaser — how a lens surface names
 * a machine (plan `2026-10-23-console-presentation-spaces` D3.3).
 *
 * Operator mode renders the machine's real name. Presentation mode — and an
 * unresolved mode — renders its session alias ("Machine A"), from the one
 * registry every panel and page in the tab shares (`machineAliases.ts`), so
 * the same machine reads the same everywhere.
 *
 * Pass EVERY identifier the surface holds (device id, hostname, display name):
 * that is what links a panel that knows a device id to one that knows the
 * hostname. Both hooks consult the registry only once the client renders: on
 * a server render and during hydration they return {@link SERVER_MACHINE_ALIAS}
 * (through `useSyncExternalStore`'s server snapshot), so a server render never
 * assigns a letter in module state that every request and tenant of the
 * process would share, and the hydration render never disagrees with the HTML.
 */

import { useCallback, useSyncExternalStore } from "react";
import { usePresentationMode } from "./PresentationModeProvider";
import { sessionMachineAliases, type MachineIdentity } from "./machineAliases";

/** What a server or hydration render shows for any machine. */
export const SERVER_MACHINE_ALIAS = "Machine";

/** Shown in operator mode when the identity carries no name at all. */
export const UNKNOWN_MACHINE_NAME = "unknown machine";

/** For `useOnTheClient`, which has nothing to wait for. */
const subscribeNever = () => () => {};

/** `false` on a server render and during hydration; `true` once on the client. */
function useOnTheClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

function operatorName(
  identity: MachineIdentity,
  label: string | null | undefined
): string {
  for (const candidate of [
    label,
    identity.displayName,
    identity.hostname,
    identity.deviceId,
  ]) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return UNKNOWN_MACHINE_NAME;
}

/**
 * The name to render for a machine. `label` is the operator-mode wording when
 * the surface has a better one than the identity's own fields.
 */
export function useMachineName(
  identity: MachineIdentity,
  label?: string | null
): string {
  const { presenting } = usePresentationMode();
  // Subscribed: a merge of two letters (`machineAliases.ts`) re-renders a
  // name that showed the retired one.
  const alias = useSyncExternalStore(
    sessionMachineAliases.subscribe,
    () => sessionMachineAliases.aliasFor(identity),
    () => SERVER_MACHINE_ALIAS
  );
  return presenting ? alias : operatorName(identity, label);
}

/**
 * The same, as a function — for lists, charts and option labels that name
 * many machines from one component.
 */
export function useMachineAliaser(): (
  identity: MachineIdentity,
  label?: string | null
) => string {
  const { presenting } = usePresentationMode();
  const onTheClient = useOnTheClient();
  // A merge of two letters re-renders the caller, so every name it built
  // with this function is rebuilt with the kept letter.
  const merges = useSyncExternalStore(
    sessionMachineAliases.subscribe,
    sessionMachineAliases.mergeCount,
    () => 0
  );
  return useCallback(
    (identity: MachineIdentity, label?: string | null) =>
      !presenting
        ? operatorName(identity, label)
        : onTheClient
          ? sessionMachineAliases.aliasFor(identity)
          : SERVER_MACHINE_ALIAS,
    // `merges` is not read inside: it is in the deps so a merge hands the
    // caller a NEW function, and a caller memoizing names by this function's
    // identity recomputes them with the kept letter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [presenting, onTheClient, merges]
  );
}

/**
 * A device's first-seen number in this session, for ordering the devices that
 * share one machine's letter (`machineAliases.ts`, "Two devices on one
 * machine"). `null` on a server or hydration render, where the registry is not
 * consulted, and for a blank id.
 */
export function useDeviceOrdinals(): (deviceId: string) => number | null {
  const onTheClient = useOnTheClient();
  return useCallback(
    (deviceId: string) =>
      onTheClient ? sessionMachineAliases.deviceOrdinalFor(deviceId) : null,
    [onTheClient]
  );
}

export interface MachineNameProps {
  identity: MachineIdentity;
  /** Operator-mode wording, when better than the identity's own fields. */
  label?: string | null;
  className?: string;
  "data-testid"?: string;
}

export function MachineName({
  identity,
  label,
  className,
  "data-testid": testId,
}: MachineNameProps) {
  const { presenting } = usePresentationMode();
  const name = useMachineName(identity, label);
  return (
    <span
      className={className}
      data-testid={testId}
      data-machine-alias={presenting ? "true" : "false"}
      title={
        presenting
          ? "Machine names are aliased in presentation mode"
          : undefined
      }
    >
      {name}
    </span>
  );
}
