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
 * hostname. The alias hook reads the registry through `useSyncExternalStore`
 * with a generic server snapshot, so a server render never touches module
 * state and the hydration render never disagrees with the HTML.
 */

import { useCallback, useSyncExternalStore } from "react";
import { usePresentationMode } from "./PresentationModeProvider";
import { sessionMachineAliases, type MachineIdentity } from "./machineAliases";

/** What a server or hydration render shows for any machine. */
export const SERVER_MACHINE_ALIAS = "Machine";

/** Shown in operator mode when the identity carries no name at all. */
export const UNKNOWN_MACHINE_NAME = "unknown machine";

/** Assigned aliases never change, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

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
  const alias = useSyncExternalStore(
    subscribeNever,
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
  return useCallback(
    (identity: MachineIdentity, label?: string | null) =>
      presenting
        ? sessionMachineAliases.aliasFor(identity)
        : operatorName(identity, label),
    [presenting]
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
