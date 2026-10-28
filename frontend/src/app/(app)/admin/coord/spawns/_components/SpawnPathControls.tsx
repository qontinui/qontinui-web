"use client";

/**
 * The spawn-path matrix's controls: the three switch writes, and the link to
 * where a per-repository switch is set.
 *
 * Each write control is rendered by its caller INSIDE `OperatorOnly` (plan
 * `2026-10-23-console-presentation-spaces` D3.2): in presentation mode it is
 * not mounted, so neither its button nor its UI Bridge registration — whose
 * custom action declares `effect: "write"` — exists in front of an audience.
 * Each registers where it renders and only while it does (`useUIElement`),
 * and its action resolves once the write's READ-BACK has landed, so an
 * automated caller reads coord's answer, not its own request.
 *
 * A control that cannot be offered is not rendered disabled with no word: the
 * matrix shows the gate's `readOnly` reason instead. A second write to a
 * switch whose first has not read back is refused by the switches hook; the
 * UI Bridge action surfaces that refusal, and a click (which the `busy` flag
 * already ignores) drops it — the first write's read-back is what shows.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { lensLinkTarget, usePresentationMode } from "@/components/presentation";
import type { AutonomyLevel } from "@/lib/api/operations/coordSettings";
import type { AutoFixPrChoice } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import { cn } from "@/lib/utils";
import { AUTONOMY_LEVELS, AUTONOMY_LEVEL_LABEL } from "../_lib/nextStepGates";

/** One option of a segmented write control. */
interface Segment<V extends string> {
  value: V;
  label: string;
}

function SegmentedWrite<V extends string>({
  id,
  label,
  description,
  options,
  current,
  busy,
  onSelect,
}: {
  id: string;
  label: string;
  description: string;
  options: readonly Segment<V>[];
  current: V;
  busy: boolean;
  onSelect: (value: V) => Promise<void>;
}) {
  const { ref } = useUIElement({
    id,
    label,
    type: "switch",
    customActions: {
      set: {
        id: "set",
        label,
        description,
        // A switch write: reversible, but a write — declared, not re-derived.
        effect: "write",
        handler: async (params?: unknown) => {
          const value = (params as { value?: unknown } | undefined)?.value;
          const match = options.find((o) => o.value === value);
          if (!match) {
            throw new Error(
              `value must be one of ${options.map((o) => o.value).join(", ")}`
            );
          }
          await onSelect(match.value);
          return true;
        },
      },
    },
  });
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
      data-testid={id}
    >
      {options.map((o, i) => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-disabled={busy || undefined}
            disabled={active}
            onClick={() => {
              if (busy || active) return;
              onSelect(o.value).catch(() => {
                // Refused only while this switch's first write reads back;
                // that write's outcome is what the matrix shows.
              });
            }}
            data-testid={`${id}-${o.value}`}
            className={cn(
              "px-2 py-0.5 text-[11px] font-medium",
              i > 0 && "border-l border-border",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              busy && "opacity-70"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The tenant default of a path's registry row. */
export function RegistrySwitch({
  agentName,
  pathLabel,
  current,
  busy,
  onSet,
}: {
  agentName: string;
  pathLabel: string;
  current: boolean;
  busy: boolean;
  onSet: (agentName: string, enabled: boolean) => Promise<void>;
}) {
  return (
    <SegmentedWrite<"on" | "off">
      id={`coord-spawns-path-switch-${agentName}`}
      label={`Switch "${pathLabel}" on or off for this tenant`}
      description={`Writes the tenant default of coord's agent registry row ${agentName} (PUT /coord/agent-registry/${agentName}), then re-reads coord's effective row. Params: {"value": "on" | "off"}. Resolves once the read-back has landed; the matrix shows what coord reads back.`}
      options={[
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
      current={current ? "on" : "off"}
      busy={busy}
      onSelect={(v) => onSet(agentName, v === "on")}
    />
  );
}

/** A next-step domain's autonomy level. */
export function AutonomySwitch({
  domain,
  pathLabel,
  level,
  busy,
  onSet,
}: {
  domain: string;
  pathLabel: string;
  level: AutonomyLevel;
  busy: boolean;
  onSet: (domain: string, level: AutonomyLevel) => Promise<void>;
}) {
  return (
    <SegmentedWrite<AutonomyLevel>
      id={`coord-spawns-path-autonomy-${domain}`}
      label={`Set the autonomy level that governs "${pathLabel}"`}
      description={`Writes the tenant's autonomy level for decision domain ${domain} (PUT /coord/next-step-settings) and applies coord's answer, which is its state after the write. Params: {"value": "always_escalate" | "guidance_only" | "auto_decide"}.`}
      options={AUTONOMY_LEVELS.map((l) => ({
        value: l,
        label: AUTONOMY_LEVEL_LABEL[l],
      }))}
      current={level}
      busy={busy}
      onSelect={(v) => onSet(domain, v)}
    />
  );
}

/** The merge-settings dial for PR fixer sessions. */
export function FixerDialSwitch({
  choice,
  busy,
  onSet,
}: {
  choice: AutoFixPrChoice;
  busy: boolean;
  onSet: (choice: AutoFixPrChoice) => Promise<void>;
}) {
  return (
    <SegmentedWrite<AutoFixPrChoice>
      id="coord-spawns-path-fixer-dial"
      label='Set the tenant dial "Spawn fixer sessions for stuck PRs"'
      description='Writes the tenant column auto_fix_pr through the merge settings (PATCH /pr-merge/settings); "default" clears the override. The dial counts as saved only when coord reads back the value sent, and reloads otherwise. Params: {"value": "default" | "on" | "off"}.'
      options={[
        { value: "default", label: "Default" },
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
      current={choice}
      busy={busy}
      onSelect={onSet}
    />
  );
}

/** The tenant merge-settings knob gating the red-main fixer. */
export function RedMainKnobSwitch({
  current,
  busy,
  onSet,
}: {
  current: boolean;
  busy: boolean;
  onSet: (enabled: boolean) => Promise<void>;
}) {
  return (
    <SegmentedWrite<"on" | "off">
      id="coord-spawns-path-red-main-knob"
      label='Set the tenant knob "auto-fix a failing main branch"'
      description='Writes the tenant column auto_fix_red_main through the merge settings (PATCH /pr-merge/settings, that key only), then re-reads the merge settings. Params: {"value": "on" | "off"}. Resolves once the read-back has landed; the matrix shows what coord reads back.'
      options={[
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
      current={current ? "on" : "off"}
      busy={busy}
      onSelect={(v) => onSet(v === "on")}
    />
  );
}

/**
 * A link to the console page where a switch is set. Where it leads is
 * `lensLinkTarget`'s decision (`console-ui-style-guide.md` §6.5): as given for
 * the operator; while presenting, carrying `?present=1` when its page can be
 * presented, and plain text otherwise — no anchor, and no UI Bridge action,
 * because a link that may not exist must not be reachable by an automated walk
 * either. While it IS a link it registers where it renders, declaring a read:
 * it only changes what is displayed.
 */
export function SetOnLink({
  id,
  href,
  label,
}: {
  id: string;
  href: string;
  label: string;
}) {
  const { presenting, source } = usePresentationMode();
  // No lens above (`absent`) is operator mode, as for `LensLink`.
  const target = lensLinkTarget(href, presenting && source !== "absent");
  if (target === null) {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        data-testid={id}
        data-lens-link="unlinked"
      >
        {label}
      </span>
    );
  }
  return <RegisteredLink id={id} href={target} label={label} />;
}

function RegisteredLink({
  id,
  href,
  label,
}: {
  id: string;
  href: string;
  label: string;
}) {
  const router = useRouter();
  const { ref } = useUIElement({
    id,
    label: `${label} — opens ${href} (navigation only)`,
    type: "link",
    customActions: {
      open: {
        id: "open",
        label: `Open ${href}`,
        description:
          "Navigates to the page where this switch is set; changes nothing.",
        effect: "read",
        handler: async () => {
          router.push(href);
          return true;
        },
      },
    },
  });
  return (
    <span ref={ref} className="inline-flex">
      <Link
        href={href}
        className="text-[11px] font-medium underline underline-offset-2 hover:no-underline"
        data-testid={id}
      >
        {label}
      </Link>
    </span>
  );
}
