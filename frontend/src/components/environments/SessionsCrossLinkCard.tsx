"use client";

/**
 * `/environments` → `/sessions?device=…` — the machines↔sessions pairing,
 * kept as navigation.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 3. That plan's
 * §9 risk table names exactly one thing deleting `/environments/sessions`
 * could break: the pairing that made the surface exist in the first place.
 * The 308 preserves `?device=` verbatim, so every existing deep link keeps
 * working — but a redirect only helps somebody who already has the URL. This
 * card is the other half: the pairing stays *discoverable* from
 * `/environments`, not merely survivable.
 *
 * ## Why a machine with no `coord_device_id` renders a dash
 *
 * `Machine.coord_device_id` is a SOFT pointer into coord's device registry —
 * nullable by construction, and omitted entirely by older backends. An absent
 * bridge means the sessions read cannot be ADDRESSED for that machine; it does
 * not mean the machine has no sessions. So the row says "not bridged to coord"
 * and offers no link, rather than linking to a filter that would confidently
 * render an empty list. Same absence-is-not-zero posture as the console's D2
 * dashes and `verification-and-evidence` `silent-empty-is-unknown`.
 */

import Link from "next/link";
import { Activity, Server } from "lucide-react";

import type { Machine } from "@/services/devenv-api";

export interface SessionsCrossLinkCardProps {
  /**
   * The fleet's machines, or `null` while the read has not answered. `null`
   * is UNKNOWN — the card says so instead of rendering as though the fleet
   * were empty.
   */
  machines: Machine[] | null;
  /** How many bridged machines to list before deferring to `/environments/machines`. */
  limit?: number;
}

const DEFAULT_LIMIT = 6;

export function SessionsCrossLinkCard({
  machines,
  limit = DEFAULT_LIMIT,
}: SessionsCrossLinkCardProps) {
  const bridged = (machines ?? []).filter((m) => Boolean(m.coord_device_id));
  const unbridged = (machines ?? []).length - bridged.length;
  const shown = bridged.slice(0, limit);

  return (
    <div
      className="card rounded-lg border border-border p-4 space-y-3"
      data-testid="environments-sessions-crosslink"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="size-4 shrink-0 text-muted-foreground" />
            Sessions by machine
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Every coord session on the fleet now lives on one console.
            Per-machine links open it pre-filtered to that device.
          </p>
        </div>
        <Link
          href="/sessions"
          className="text-xs text-primary hover:underline shrink-0"
          data-testid="environments-sessions-all-link"
        >
          All sessions
        </Link>
      </div>

      {machines === null ? (
        <p className="text-xs text-muted-foreground" data-testid="environments-sessions-unknown">
          – machines not loaded
        </p>
      ) : bridged.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No machine is bridged to a coord device yet, so no per-machine filter
          can be addressed.{" "}
          <Link href="/environments/machines" className="text-primary hover:underline">
            Machines
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {shown.map((m) => (
            <Link
              key={m.id}
              href={`/sessions?device=${encodeURIComponent(m.coord_device_id as string)}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              data-testid="environments-sessions-device-link"
            >
              <Server className="size-3 text-muted-foreground" />
              <span className="font-mono truncate max-w-[20ch]">
                {m.hostname || m.name}
              </span>
            </Link>
          ))}
          {bridged.length > shown.length && (
            <Link
              href="/environments/machines"
              className="text-xs text-primary hover:underline"
            >
              +{bridged.length - shown.length} more
            </Link>
          )}
        </div>
      )}

      {unbridged > 0 && (
        <p className="text-xs text-muted-foreground">
          {unbridged} machine{unbridged === 1 ? "" : "s"} not bridged to coord —
          their sessions cannot be addressed by device, which is not the same as
          having none.
        </p>
      )}
    </div>
  );
}
