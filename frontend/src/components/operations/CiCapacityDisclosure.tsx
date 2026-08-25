"use client";

/**
 * CI capacity on a Dev Ops machine row — the SECOND mount point of
 * `CiNodeConfigPanel`, and plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 2.
 *
 * ## One implementation, two mount points — not a fork
 *
 * This file renders `CiNodeConfigPanel` and resolves which machine to render
 * it for. It holds **no fetch of its own, no CI-node state of its own, and no
 * defaults of its own**: the panel imported here is byte-for-byte the one
 * `/environments/machines` mounts, and it calls the same `getCiNodeConfig` /
 * `setCiNodeConfig` in `services/devenv-api.ts`. That is the phase's central
 * constraint, and it is asserted executably in `CiCapacityDisclosure.test.tsx`
 * — if this file ever grows a config fetch, a draft config, or a friendlier
 * default, the phase has failed and that test fails with it.
 *
 * It is deliberately unlike the `GatesPanel` / `/admin/coord/gates` pair
 * elsewhere in the same plan, which is two implementations over two different
 * backend reads.
 *
 * **`CiNodeConfigPanel` stays in `app/(app)/environments/_components/`.**
 * `/environments/machines` owns machine enrolment, revocation and environment
 * binding, and the CI control is that flow's natural next step; moving the
 * file would edit that route for this phase's benefit. Importing across the
 * route boundary keeps ONE component, which is what the constraint is about.
 *
 * **`CiNodeConfig` mirrors a Rust struct that is the authority.** When the
 * runner's `CiNodeSettings` (`qontinui-runner/src-tauri/src/settings.rs`)
 * gains a field it lands in `services/devenv-api.ts`, the backend
 * `CiNodeConfig`, and **both mount points** in the same PR — the standing rule
 * at `devenv-api.ts` §CI-node configuration. Because both mount points render
 * the same component, "both mount points" costs nothing here as long as this
 * file keeps rendering the panel rather than reimplementing any part of it.
 *
 * ## Why a disclosure, and why it does not remember being open
 *
 * `enabled` and `repo_allowlist` are consent surfaces, not preferences, so
 * the panel must not be the first thing a hand lands on while reading fleet
 * telemetry: the panel is collapsed on every load. It carries no `storageKey`
 * for exactly that reason — the persisted-open behaviour every other console
 * panel has would put a consent control under a scrolling cursor on the next
 * visit. Collapsed also means UNMOUNTED, so a closed row costs no
 * `GET /machines/{id}/ci-node` at all.
 *
 * **It also carries no collapsed `summary`, and that is not an oversight of
 * R7.** R7 says a panel folds away detail, never signal — which presupposes
 * the page already HAS the signal. This one does not: the machine's requested
 * CI posture is only knowable by reading `/machines/{id}/ci-node`, one request
 * per row, and doing that eagerly would both add a fetch per machine card and
 * put a number in the header that is a *request*, never a reading of what the
 * runner is running. A badge saying "CI on" that nothing can confirm is the
 * exact claim the panel inside refuses to make. What the header would have
 * summarised, `CiRunnerBadge` above it already answers from telemetry: what
 * this machine is taking right now.
 *
 * ## Why the un-joined cases render prose instead of a greyed-out control
 *
 * A disabled toggle reads as "CI is off on this machine". That is a claim
 * about the machine; the truth in all four non-linked cases is a statement
 * about the JOIN (see `ciCapacity.ts`). So each renders what is actually known
 * plus the place to act on it.
 */

import Link from "next/link";
import { Cpu, ExternalLink, HelpCircle } from "lucide-react";
import { CollapsiblePanel } from "@/components/console";
import { CiNodeConfigPanel } from "@/app/(app)/environments/_components/CiNodeConfigPanel";
import type { CiCapacityJoin } from "./ciCapacity";

/** The one place this component sends a reader who needs to act. */
const MACHINES_HREF = "/environments/machines";

function MachinesLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={MACHINES_HREF}
      className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:no-underline"
      data-testid="ci-capacity-environments-link"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

/** The shared shell for every state where there is no panel to render. */
function CiCapacityNotice({
  state,
  headline,
  children,
}: {
  state: CiCapacityJoin["state"];
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5"
      role="status"
      data-testid="ci-capacity-unavailable"
      data-ci-capacity={state}
    >
      <div className="flex items-center gap-1.5">
        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {headline}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{children}</p>
    </div>
  );
}

export interface CiCapacityDisclosureProps {
  join: CiCapacityJoin;
}

export function CiCapacityDisclosure({ join }: CiCapacityDisclosureProps) {
  if (join.state === "linked") {
    return (
      <div data-ci-capacity="linked" data-machine-id={join.machine.id}>
        <CollapsiblePanel
          data-testid="ci-capacity-disclosure"
          // No `storageKey`, deliberately — see the module doc. A consent
          // surface opens because someone opened it, this time.
          defaultOpen={false}
          titleAs="div"
          icon={<Cpu className="h-3.5 w-3.5" />}
          title="CI builds"
          className="border-dashed p-3"
        >
          <CiNodeConfigPanel machine={join.machine} />
        </CollapsiblePanel>
      </div>
    );
  }

  if (join.state === "no_machine") {
    return (
      <CiCapacityNotice state={join.state} headline="No machine record linked">
        Coord reports this device, but no machine record in this tenant points
        at it, so there is nothing to configure CI against. Enrol it under{" "}
        <MachinesLink>Environments &rarr; Machines</MachinesLink> to configure
        CI here. This is a gap in the link, not a setting: nothing here says
        whether CI is on or off on that machine.
      </CiCapacityNotice>
    );
  }

  if (join.state === "ambiguous") {
    return (
      <CiCapacityNotice
        state={join.state}
        headline="More than one machine record linked"
      >
        {join.machines.length} machine records name this coord device (
        {join.machines.map((m) => m.name).join(", ")}). Offering one of them
        here would write CI settings for a machine you did not choose, so this
        row offers none. Pick the right one under{" "}
        <MachinesLink>Environments &rarr; Machines</MachinesLink>.
      </CiCapacityNotice>
    );
  }

  if (join.state === "no_device") {
    return (
      <CiCapacityNotice
        state={join.state}
        headline="No coord device to match on"
      >
        This host reached the list through the runner inventory, and
        coord&apos;s device read carries no row for it &mdash; so there is no
        device id to match a machine record against. Configure its CI under{" "}
        <MachinesLink>Environments &rarr; Machines</MachinesLink>.
      </CiCapacityNotice>
    );
  }

  return (
    <CiCapacityNotice state={join.state} headline="CI capacity unknown">
      {join.reason} Whether a machine record is linked to this device is
      therefore unknown &mdash; not that none is.
    </CiCapacityNotice>
  );
}
