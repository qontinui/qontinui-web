"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Rocket, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { OPERATIONS_API } from "@/components/operations/utils";
import { httpClient } from "@/services/service-factory";

// ----------------------------------------------------------------------------
// Demo intent catalog — the 3 deterministic features per
// `plans/2026-05-18-coordination-layer-demos-feature-{1,2,3}-*.md`.
// Mirrors the catalog in `operations/mergeTypes.ts:DEMO_FEATURES` so
// the LandedFeaturesPanel can match `events.merge.landed.*` events to
// the right card. Kept inline here to avoid a cross-PR dependency
// during the initial substrate land.
// ----------------------------------------------------------------------------

interface DemoIntent {
  /** Feature slug; matches `DEMO_FEATURES[].slug` in mergeTypes. */
  slug: string;
  title: string;
  /** Branch name the agent ships its work on. */
  branch: string;
  /** Prompt handed to the fresh Claude Code session in the worktree. */
  prompt: string;
}

const DEMO_INTENTS: ReadonlyArray<DemoIntent> = [
  {
    slug: "profile",
    title: "Profile",
    branch: "demo-feature-profile",
    prompt:
      "Implement plans/2026-05-18-coordination-layer-demos-feature-1-profile.md exactly. Single new file at qontinui-web/frontend/src/app/(app)/demo/profile/page.tsx. Commit on branch demo-feature-profile. POST /merge/propose when done.",
  },
  {
    slug: "fleet-pulse",
    title: "Fleet Pulse",
    branch: "demo-feature-fleet-pulse",
    prompt:
      "Implement plans/2026-05-18-coordination-layer-demos-feature-2-fleet-pulse.md exactly. Single new file at qontinui-web/frontend/src/app/(app)/demo/fleet-pulse/page.tsx. Commit on branch demo-feature-fleet-pulse. POST /merge/propose when done.",
  },
  {
    slug: "clock",
    title: "Clock",
    branch: "demo-feature-clock",
    prompt:
      "Implement plans/2026-05-18-coordination-layer-demos-feature-3-clock.md exactly. Single new file at qontinui-web/frontend/src/app/(app)/demo/clock/page.tsx. Commit on branch demo-feature-clock. POST /merge/propose when done.",
  },
];

// ----------------------------------------------------------------------------
// Wire types for the fleet endpoint (just the bits we need).
// ----------------------------------------------------------------------------

interface FleetRunner {
  id?: string;
  hostname?: string;
  machine_id?: string;
  derivedStatus?: string;
  derived_status?: string;
}

interface FleetResponse {
  runners: FleetRunner[];
}

interface AllocationResult {
  slug: string;
  status: "pending" | "success" | "error";
  agentId?: string;
  worktreePath?: string;
  error?: string;
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function DemoControlPage() {
  const { user } = useAuth();

  const [runners, setRunners] = useState<FleetRunner[] | null>(null);
  const [primaryMachineId, setPrimaryMachineId] = useState<string>("");
  const [secondaryMachineId, setSecondaryMachineId] = useState<string>("");
  const [parentSha, setParentSha] = useState<string>("main");
  const [launching, setLaunching] = useState(false);
  const [results, setResults] = useState<AllocationResult[]>([]);

  // Fetch fleet to populate machine pickers.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await httpClient.fetch(`${OPERATIONS_API}/fleet`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as FleetResponse;
        if (cancelled) return;
        const list = body.runners ?? [];
        setRunners(list);
        const healthy = list.filter(
          (r) => (r.derivedStatus ?? r.derived_status) === "healthy"
        );
        if (healthy[0]?.machine_id) setPrimaryMachineId(healthy[0].machine_id);
        if (healthy[1]?.machine_id)
          setSecondaryMachineId(healthy[1].machine_id);
      } catch {
        if (!cancelled) setRunners([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const launch = useCallback(async () => {
    if (!primaryMachineId || !secondaryMachineId) return;
    setLaunching(true);
    setResults(DEMO_INTENTS.map((i) => ({ slug: i.slug, status: "pending" })));

    // Per §3.2 + the resolved D5, two intents go to the primary
    // (PC) machine and one to the secondary (MSI). Order is preserved:
    // first two intents → primary, third → secondary.
    const assignments = DEMO_INTENTS.map((intent, idx) => ({
      intent,
      machine_id: idx < 2 ? primaryMachineId : secondaryMachineId,
    }));

    const settled = await Promise.allSettled(
      assignments.map(async ({ intent, machine_id }) => {
        const res = await httpClient.fetch(`${OPERATIONS_API}/agents/allocate`, {
          method: "POST",
          body: JSON.stringify({
            machine_id,
            repos: [{ repo: "qontinui-web", parent_sha: parentSha }],
            intent: intent.prompt,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          agent_id: string;
          worktrees: Array<{ worktree_path: string }>;
        };
      })
    );

    setResults(
      DEMO_INTENTS.map((intent, idx) => {
        const r = settled[idx];
        if (r?.status === "fulfilled") {
          return {
            slug: intent.slug,
            status: "success",
            agentId: r.value.agent_id,
            worktreePath: r.value.worktrees[0]?.worktree_path,
          };
        }
        return {
          slug: intent.slug,
          status: "error",
          error:
            r?.status === "rejected"
              ? r.reason instanceof Error
                ? r.reason.message
                : String(r.reason)
              : "unknown",
        };
      })
    );
    setLaunching(false);
  }, [primaryMachineId, secondaryMachineId, parentSha]);

  if (!user) return null;

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Demo Control</h1>
            <p className="text-xs text-muted-foreground">
              One click → three agents materialize across two machines.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Machine targets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {runners === null ? (
              <Skeleton className="h-16" />
            ) : runners.length === 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  No runners visible in the fleet. Verify PC + MSI are
                  online before launching.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <MachinePicker
                  label="Primary (2 agents)"
                  value={primaryMachineId}
                  onChange={setPrimaryMachineId}
                  runners={runners}
                />
                <MachinePicker
                  label="Secondary (1 agent)"
                  value={secondaryMachineId}
                  onChange={setSecondaryMachineId}
                  runners={runners}
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">
                qontinui-web parent SHA (worktree branches from here)
              </label>
              <input
                type="text"
                value={parentSha}
                onChange={(e) => setParentSha(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
                spellCheck={false}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <Button
              size="lg"
              onClick={launch}
              disabled={
                launching ||
                !primaryMachineId ||
                !secondaryMachineId ||
                !parentSha
              }
              className="w-full"
            >
              {launching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Launching…
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Launch demo
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allocation status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {results.map((r) => {
                  const intent = DEMO_INTENTS.find((i) => i.slug === r.slug);
                  return (
                    <AllocationCard
                      key={r.slug}
                      title={intent?.title ?? r.slug}
                      branch={intent?.branch ?? ""}
                      result={r}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function MachinePicker({
  label,
  value,
  onChange,
  runners,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  runners: FleetRunner[];
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
      >
        <option value="">— select runner —</option>
        {runners.map((r) => {
          const id = r.machine_id ?? r.id ?? "";
          if (!id) return null;
          const status = r.derivedStatus ?? r.derived_status ?? "unknown";
          return (
            <option key={id} value={id}>
              {r.hostname ?? id.slice(0, 8)} ({status})
            </option>
          );
        })}
      </select>
    </div>
  );
}

function AllocationCard({
  title,
  branch,
  result,
}: {
  title: string;
  branch: string;
  result: AllocationResult;
}) {
  return (
    <div className="border rounded-md p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        {result.status === "pending" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {result.status === "success" && (
          <CheckCircle2 className="h-4 w-4 text-green-400" />
        )}
        {result.status === "error" && (
          <XCircle className="h-4 w-4 text-red-400" />
        )}
      </div>
      <Badge variant="outline" className="font-mono text-[10px]">
        {branch}
      </Badge>
      {result.status === "success" && result.agentId && (
        <p className="text-[10px] text-muted-foreground font-mono break-all">
          {result.agentId.slice(0, 8)}…
        </p>
      )}
      {result.status === "error" && result.error && (
        <p className="text-[10px] text-red-300">{result.error}</p>
      )}
    </div>
  );
}
