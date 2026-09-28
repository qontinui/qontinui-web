"use client";

/**
 * The machine ↔ CI-host join, declared by an operator (plan §D2, path 2).
 *
 * The join is DECLARED, never inferred from names: `spaceship` and
 * `gh-runner-spaceship-wsl@…` look alike and a wrong guess pauses the wrong
 * box. So a machine with no declared host says exactly that — "No CI host
 * linked — link one" — and offers the one small form that fixes it. A linked
 * host can be unlinked here too, which is the fix a `ci_host_linked_elsewhere`
 * refusal on ANOTHER machine points at.
 *
 * `ci_host` is the bare GitHub runner name (what coord's `drain-host` and label
 * routes take), never the synthetic `gh-runner-*@repo` hostname.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import type {
  MachineEntry,
  MaintenanceError,
} from "@/components/operations/maintenanceWindow";
import {
  linkCiHost,
  unlinkCiHost,
} from "@/components/operations/useMaintenanceWindow";

export function CiHostLink({
  entry,
  onChanged,
}: {
  entry: MachineEntry;
  onChanged: () => void;
}) {
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MaintenanceError | null>(null);

  if (entry.kind === "ci_host") {
    return (
      <p
        className="text-xs text-muted-foreground break-words"
        data-testid="coord-maintenance-ci-host-unlinked"
      >
        CI host <span className="font-mono break-all">{entry.ciHost}</span> is
        linked to no workstation machine. Link it from its machine&apos;s page
        so one window pauses both.
      </p>
    );
  }

  const link = async () => {
    const value = host.trim();
    if (value === "" || busy) return;
    setBusy(true);
    setError(null);
    const res = await linkCiHost({ deviceId: entry.deviceId, ciHost: value });
    setBusy(false);
    if (res.ok) {
      setHost("");
      toast.success(`Linked CI host ${value}`);
      onChanged();
    } else {
      setError(res);
    }
  };

  const unlink = async (ciHost: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await unlinkCiHost({ deviceId: entry.deviceId, ciHost });
    setBusy(false);
    if (res.ok) {
      toast.success(`Unlinked CI host ${ciHost}`);
      onChanged();
    } else {
      setError(res);
    }
  };

  return (
    <div className="space-y-1.5" data-testid="coord-maintenance-ci-hosts">
      {entry.ciHosts.length === 0 ? (
        <p
          className="text-xs break-words"
          data-testid="coord-maintenance-ci-host-none"
        >
          No CI host linked — link one. Until a GitHub runner name is linked,
          pausing CI here cannot stop GitHub routing jobs to this machine.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 text-xs">
          {entry.ciHosts.map((h) => (
            <li
              key={h}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1"
              data-testid="coord-maintenance-ci-host"
            >
              <span className="text-muted-foreground">CI host</span>
              <span className="font-mono break-all">{h}</span>
              <CoordAdminOnly>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px]"
                  disabled={busy}
                  onClick={() => void unlink(h)}
                  data-testid="coord-maintenance-ci-host-unlink"
                >
                  Unlink
                </Button>
              </CoordAdminOnly>
            </li>
          ))}
        </ul>
      )}
      {entry.ciHosts.length === 0 && (
        <CoordAdminOnly fallback={<ReadOnlyNotice />}>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void link();
            }}
            data-testid="coord-maintenance-ci-host-link-form"
          >
            <div className="space-y-1">
              <Label
                htmlFor="coord-maintenance-ci-host-input"
                className="text-xs"
              >
                Link a CI host to this machine
              </Label>
              <Input
                id="coord-maintenance-ci-host-input"
                value={host}
                disabled={busy}
                onChange={(e) => setHost(e.target.value)}
                placeholder="GitHub runner name, e.g. merytshost"
                className="h-8 w-64 text-xs"
                data-testid="coord-maintenance-ci-host-input"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || host.trim() === ""}
              data-testid="coord-maintenance-ci-host-link"
            >
              Link
            </Button>
          </form>
        </CoordAdminOnly>
      )}
      {error && (
        <p
          role="alert"
          className="text-xs text-destructive break-words"
          data-testid="coord-maintenance-ci-host-error"
        >
          {error.message}
          {error.code ? ` (${error.code})` : ""}
        </p>
      )}
    </div>
  );
}
