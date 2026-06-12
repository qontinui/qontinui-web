"use client";

/**
 * SpawnModal — operator authoring surface for `POST /agents/spawn`.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4).
 *
 * Inputs:
 *   - plan_slug   (preset by parent — disabled, contextual)
 *   - plan_phase  (free-text; the plan owns phase nomenclature)
 *   - device_id   (dropdown, sourced from /operations/fleet/health)
 *   - repos       (multi-select checkbox list of known repos)
 *   - intent      (short free-text description)
 *   - declared_overlap_paths (newline-delimited list, optional)
 *   - initial_prompt (the agent's first-tick prompt body)
 *
 * Submit → POST /api/v1/operations/agents/spawn. On success: toast + the
 * coord-side agent_id is surfaced; the parent decides whether to
 * navigate (we don't auto-route — operators are spawning many agents
 * in sequence during readiness waves).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket } from "lucide-react";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;

/**
 * Canonical repo slug list. Mirrors the set coord uses for
 * `declared_overlap_paths` repo scoping. Operators can still
 * declare repos that aren't in this list by typing them into the
 * "other repos" field — we union both before submit.
 */
const KNOWN_REPOS = [
  "qontinui-web",
  "qontinui-runner",
  "qontinui-coord",
  "qontinui-schemas",
  "qontinui-mobile",
  "qontinui-ui-bridge",
  "qontinui-dev-notes",
] as const;

interface FleetHealthDevice {
  device_id: string;
  hostname?: string;
  /** Coord `DeviceState` (serde-lowercase): healthy | degraded | partitioned | abandoned. */
  state?: string;
}

interface FleetHealthPayload {
  devices?: FleetHealthDevice[];
}

export interface SpawnModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /** Plan slug to spawn for (set by the parent page row). */
  planSlug: string;
  /** Plan phase pre-seed; the user can override before submitting. */
  initialPhase?: string;
  /** Called after a successful spawn with the coord response body. */
  onSuccess?: (agent: { agent_id?: string; [k: string]: unknown }) => void;
}

export function SpawnModal({
  open,
  onClose,
  planSlug,
  initialPhase,
  onSuccess,
}: SpawnModalProps) {
  const [phase, setPhase] = useState(initialPhase ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [otherRepos, setOtherRepos] = useState("");
  const [intent, setIntent] = useState("");
  const [overlapPaths, setOverlapPaths] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<FleetHealthDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  // Reset form state on every open so a fresh spawn doesn't inherit
  // the previous one.
  useEffect(() => {
    if (!open) return;
    setPhase(initialPhase ?? "");
    setDeviceId("");
    setSelectedRepos([]);
    setOtherRepos("");
    setIntent("");
    setOverlapPaths("");
    setInitialPrompt("");
    setError(null);
    setSubmitting(false);
  }, [open, initialPhase]);

  // Populate device dropdown from coord fleet health.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDevicesLoading(true);
    fetch(`${API}/fleet/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: FleetHealthPayload) => {
        if (cancelled) return;
        setDevices(body.devices ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        // Fall through silently — operator can still type a device ID
        // via the free-text alternative if coord is unreachable.
        console.warn("[SpawnModal] fleet/health fetch failed", e);
      })
      .finally(() => {
        if (cancelled) return;
        setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleRepo = useCallback((repo: string) => {
    setSelectedRepos((prev) =>
      prev.includes(repo)
        ? prev.filter((r) => r !== repo)
        : [...prev, repo]
    );
  }, []);

  const allRepos = useMemo(() => {
    const extras = otherRepos
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...selectedRepos, ...extras]));
  }, [selectedRepos, otherRepos]);

  const parsedOverlapPaths = useMemo(
    () =>
      overlapPaths
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [overlapPaths]
  );

  const canSubmit =
    !submitting &&
    planSlug.length > 0 &&
    phase.trim().length > 0 &&
    deviceId.length > 0 &&
    allRepos.length > 0 &&
    intent.trim().length > 0 &&
    initialPrompt.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        plan_slug: planSlug,
        plan_phase: phase.trim(),
        device_id: deviceId,
        repos: allRepos,
        intent: intent.trim(),
        declared_overlap_paths: parsedOverlapPaths,
        initial_prompt: initialPrompt.trim(),
      };
      const res = await fetch(`${API}/agents/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const result = (await res.json()) as {
        agent_id?: string;
        [k: string]: unknown;
      };
      toast.success(
        result.agent_id
          ? `Spawned agent ${result.agent_id}`
          : "Agent spawned"
      );
      onSuccess?.(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    planSlug,
    phase,
    deviceId,
    allRepos,
    intent,
    parsedOverlapPaths,
    initialPrompt,
    onSuccess,
    onClose,
  ]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="coord-spawn-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Spawn agent from plan
          </DialogTitle>
          <DialogDescription>
            Mint a coord agent pinned to a device. Coord acquires
            claims, allocates the device, and delivers your initial
            prompt on first tick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="spawn-plan-slug">Plan</Label>
            <Input
              id="spawn-plan-slug"
              value={planSlug}
              readOnly
              disabled
              className="font-mono text-xs"
              data-testid="coord-spawn-plan-slug"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-plan-phase">Phase</Label>
            <Input
              id="spawn-plan-phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              placeholder='e.g. "Phase 4" or "Wave 4 — spawn UI"'
              data-testid="coord-spawn-phase"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-device">Device</Label>
            {devicesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={deviceId} onValueChange={setDeviceId}>
                <SelectTrigger
                  id="spawn-device"
                  data-testid="coord-spawn-device-select"
                >
                  <SelectValue placeholder="Choose a device" />
                </SelectTrigger>
                <SelectContent>
                  {devices.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No devices reporting
                    </SelectItem>
                  )}
                  {devices.map((d) => (
                    <SelectItem key={d.device_id} value={d.device_id}>
                      <span className="font-mono text-xs">
                        {d.hostname || d.device_id}
                      </span>
                      {d.state && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({d.state})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Repos</Label>
            <div
              className="grid grid-cols-2 gap-1.5 rounded-md border border-border p-2"
              data-testid="coord-spawn-repos"
            >
              {KNOWN_REPOS.map((repo) => {
                const id = `spawn-repo-${repo}`;
                const checked = selectedRepos.includes(repo);
                return (
                  <label
                    key={repo}
                    htmlFor={id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={() => toggleRepo(repo)}
                      data-testid={`coord-spawn-repo-${repo}`}
                    />
                    <span className="font-mono text-xs">{repo}</span>
                  </label>
                );
              })}
            </div>
            <Input
              value={otherRepos}
              onChange={(e) => setOtherRepos(e.target.value)}
              placeholder="other repos (comma-separated)"
              className="text-xs"
              data-testid="coord-spawn-other-repos"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-intent">Intent</Label>
            <Input
              id="spawn-intent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="One-liner describing what this agent will do"
              data-testid="coord-spawn-intent"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-overlap">
              Declared overlap paths (one per line, optional)
            </Label>
            <Textarea
              id="spawn-overlap"
              rows={3}
              value={overlapPaths}
              onChange={(e) => setOverlapPaths(e.target.value)}
              placeholder={"backend/app/api/v1/endpoints/operations.py\nfrontend/src/app/(app)/admin/coord/spawn/page.tsx"}
              className="font-mono text-xs"
              data-testid="coord-spawn-overlap-paths"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-prompt">Initial prompt</Label>
            <Textarea
              id="spawn-prompt"
              rows={6}
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="You are Wave N of plan X. Your scope: ..."
              data-testid="coord-spawn-initial-prompt"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="coord-spawn-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            data-testid="coord-spawn-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="coord-spawn-submit"
          >
            {submitting ? "Spawning..." : "Spawn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
