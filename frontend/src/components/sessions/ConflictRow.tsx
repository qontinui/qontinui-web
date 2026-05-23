"use client";

/**
 * ConflictRow — Phase 6 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Surfaces an active claim conflict (two sessions contesting the same
 * `RepoBranch` claim or similar) as a two-sided card in the Live
 * Sessions panel.
 *
 * Layout
 * ------
 *
 *  ┌──────────────────────────── conflict ────────────────────────────┐
 *  │ HOLDER (left)                │ CHALLENGER (right)                │
 *  │   hostname · kind            │   hostname · kind                 │
 *  │   intent.purpose             │   intent.purpose                  │
 *  │   started Xm ago             │   started Ym ago                  │
 *  │   file claims (n)            │   file claims (n)                 │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │ [ Wait ]   [ Steal (reason) ]   [ Open different branch ▾ ]      │
 *  └──────────────────────────────────────────────────────────────────┘
 *
 *  - **Wait**: dismiss this row; UX assumes the operator will check
 *    back, or rely on the runner's heartbeat-stale auto-release.
 *  - **Steal**: opens `StealModal` (10-char-min reason gate).
 *  - **Open different branch**: best-effort branch-name suggestion
 *    derived from the held branch name (e.g. add `-alt-1`).
 */

import { useCallback, useMemo, useState } from "react";
import {
  Terminal,
  Bot,
  Workflow,
  PlayCircle,
  Bug,
  Cpu,
  GitBranch,
  AlertTriangle,
  Lock,
  ArrowRightLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/components/operations/utils";
import { StealModal } from "./StealModal";
import type { SessionIntent, SessionRow } from "./types";

const KIND_ICON: Record<string, React.ElementType> = {
  terminal_shell: Terminal,
  terminal_claude: Bot,
  agentic: Bot,
  workflow: Workflow,
  automation: PlayCircle,
  debug: Bug,
};

export interface ConflictRowProps {
  /** Session currently holding the contested claim. */
  holder: SessionRow;
  /** Session that triggered the conflict (e.g. the local operator). */
  challenger: SessionRow;
  /**
   * Resource key string, e.g. `repo_branch:qontinui-web:main`. Used to
   * derive auto-suggested alternate branch names.
   */
  resourceKey: string;
  /** File claims currently held by `holder`. Optional, best-effort. */
  holderFileClaims?: string[];
  /** File claims currently held by `challenger`. Optional, best-effort. */
  challengerFileClaims?: string[];
  /** Resolve a device_id to a human hostname. */
  hostnameFor?: (deviceId: string) => string | undefined;
  /** Called when the operator clicks "Wait" — caller dismisses the row. */
  onWait?: () => void;
  /** Called after a successful steal so the parent refreshes. */
  onStealSucceeded?: () => void;
  /** Called when the operator picks an alternate branch suggestion. */
  onSelectAlternateBranch?: (branch: string) => void;
}

function getIntent(intent: SessionRow["intent"]): SessionIntent {
  if (intent && typeof intent === "object") {
    return intent as SessionIntent;
  }
  return { purpose: "" };
}

/**
 * Derive 2-3 alternate branch suggestions from the held branch name.
 *
 * The dashboard does not have git refs on hand for the contested repo,
 * so this is purely a name hint: append `-alt-1`, `-alt-2`, `-alt-3`.
 * Operators that want git-truth pick the suggestion in their local
 * checkout, where git will tell them whether the name already exists.
 */
export function deriveAlternateBranches(branch: string): string[] {
  const trimmed = branch.trim();
  if (!trimmed) return [];
  // Strip any trailing `-alt-N` so we don't get `feat-x-alt-1-alt-1`.
  const stripped = trimmed.replace(/-alt-\d+$/, "");
  return [`${stripped}-alt-1`, `${stripped}-alt-2`, `${stripped}-alt-3`];
}

function SideCard({
  session,
  label,
  hostnameFor,
  fileClaims,
}: {
  session: SessionRow;
  label: string;
  hostnameFor?: (deviceId: string) => string | undefined;
  fileClaims?: string[];
}) {
  const Icon = KIND_ICON[session.session_kind] ?? Cpu;
  const intent = getIntent(session.intent);
  const hostname = hostnameFor?.(session.device_id);
  const identity = hostname ?? `${session.device_id.slice(0, 8)}…`;
  const fileClaimCount = fileClaims?.length ?? 0;

  return (
    <div
      className="flex-1 min-w-0 space-y-2 rounded-md border border-border/40 bg-muted/20 p-3"
      data-ui-bridge-id="conflict-row.side"
      data-conflict-side={label}
      data-session-id={session.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span
            className="font-medium text-sm truncate"
            data-ui-bridge-id="conflict-row.side-host"
          >
            {identity}
          </span>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] uppercase tracking-wider"
        >
          {label}
        </Badge>
      </div>

      <p
        className="text-xs text-foreground/80 line-clamp-2"
        data-ui-bridge-id="conflict-row.side-purpose"
        title={intent.purpose || "(no purpose declared)"}
      >
        {intent.purpose || "(no purpose declared)"}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {session.session_kind}
        </Badge>
        <span data-ui-bridge-id="conflict-row.side-started-at">
          started {relativeTime(session.started_at)}
        </span>
      </div>

      {(session.repo || session.branch) && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {session.repo ?? "(no repo)"}
            {session.branch ? ` · ${session.branch}` : ""}
          </span>
        </div>
      )}

      <div
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        data-ui-bridge-id="conflict-row.side-file-claims"
      >
        <Lock className="h-3 w-3" />
        <span>
          {fileClaimCount === 0
            ? "no file claims held"
            : `${fileClaimCount} file ${fileClaimCount === 1 ? "claim" : "claims"} held`}
        </span>
      </div>
    </div>
  );
}

export function ConflictRow({
  holder,
  challenger,
  resourceKey,
  holderFileClaims,
  challengerFileClaims,
  hostnameFor,
  onWait,
  onStealSucceeded,
  onSelectAlternateBranch,
}: ConflictRowProps) {
  const [stealOpen, setStealOpen] = useState(false);

  const alternates = useMemo(() => {
    const branch = holder.branch ?? challenger.branch ?? "";
    return deriveAlternateBranches(branch);
  }, [holder.branch, challenger.branch]);

  const onStealSuccess = useCallback(() => {
    setStealOpen(false);
    onStealSucceeded?.();
  }, [onStealSucceeded]);

  return (
    <Card
      className="border-orange-500/40 bg-orange-500/5"
      data-ui-bridge-id="conflict-row"
      data-resource-key={resourceKey}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-400" />
          <span>Active claim conflict</span>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-mono"
            data-ui-bridge-id="conflict-row.resource-key"
          >
            {resourceKey}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <SideCard
            session={holder}
            label="holder"
            hostnameFor={hostnameFor}
            fileClaims={holderFileClaims}
          />
          <SideCard
            session={challenger}
            label="challenger"
            hostnameFor={hostnameFor}
            fileClaims={challengerFileClaims}
          />
        </div>

        <div
          className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40"
          data-ui-bridge-id="conflict-row.actions"
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={onWait}
            data-ui-bridge-id="conflict-row.wait"
          >
            Wait
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setStealOpen(true)}
            data-ui-bridge-id="conflict-row.steal"
          >
            Steal…
          </Button>
          {alternates.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  data-ui-bridge-id="conflict-row.alternate-branch"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                  Open different branch
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {alternates.map((name) => (
                  <DropdownMenuItem
                    key={name}
                    onClick={() => onSelectAlternateBranch?.(name)}
                    data-ui-bridge-id="conflict-row.alternate-branch-option"
                    data-branch={name}
                    className="font-mono text-xs"
                  >
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>

      <StealModal
        open={stealOpen}
        onOpenChange={setStealOpen}
        session={holder}
        challenger={challenger}
        onSucceeded={onStealSuccess}
        hostnameFor={hostnameFor}
      />
    </Card>
  );
}
