"use client";

/**
 * One archived session in the repository list.
 *
 * Why this is not the live-session row: the console's `RecordRow` (and the
 * 394-line `components/sessions/SessionCard` it replaced, deleted by
 * `2026-08-26-sessions-console-consolidation` Phase 3) renders a LIVE
 * `coord.sessions` row and is built out of fields an archived row does not
 * have — `device_id` → hostname, heartbeat health, claims count, agent
 * blocked/correlation status, coord lineage. Reusing it here would mean
 * synthesising those fields, i.e. rendering "no heartbeat yet" and "0 files
 * locked" for a session that finished weeks ago and whose coord row has since
 * been GC'd. The card's chrome idioms (icon + name + chips, a repo/branch
 * line, a footer of times) are followed deliberately so the two lists read as
 * siblings; the fields are the archive's own.
 *
 * The three honesty chips are always rendered — attribution, digest claim and
 * closeout — because their absence is what a reader would misread as "fine".
 */

import Link from "next/link";
import { Bot, Clock, GitBranch, Layers, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { relativeTime } from "@/components/operations/utils";
import {
  CloseoutBadge,
  DigestBadge,
  SecretFindingsBadge,
  TenantAttributionBadge,
} from "./HonestyBadges";
import {
  displayName,
  displayNameSource,
  formatBytes,
  type SessionArtifactSummary,
} from "./types";

function stateBadgeClass(state: string): string {
  switch (state) {
    case "open":
      return "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/10";
    case "closed":
      return "border-border text-muted-foreground bg-muted/20";
    case "abandoned":
      return "border-orange-500/50 text-orange-700 dark:text-orange-300 bg-orange-500/10";
    default:
      return "border-border text-muted-foreground";
  }
}

export function SessionArtifactRow({
  item,
}: {
  item: SessionArtifactSummary;
}) {
  const name = displayName(item);
  const nameSource = displayNameSource(item);

  return (
    <Link
      href={`/sessions/repository/${item.id}`}
      className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-ui-bridge-id="session-repository.row-link"
      data-session-artifact-id={item.id}
    >
      <Card
        className="gap-2 py-3 transition-shadow hover:shadow-lg"
        data-ui-bridge-id="session-repository.row"
        data-session-state={item.state}
        data-closeout-state={item.closeout_state}
        data-tenant-source={item.tenant_source}
      >
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span
                className="truncate font-medium"
                title={name}
                data-ui-bridge-id="session-repository.row-name"
              >
                {name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                ({nameSource})
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge
                variant="outline"
                className={`px-1.5 py-0 text-[10px] ${stateBadgeClass(item.state)}`}
                data-ui-bridge-id="session-repository.row-state"
              >
                {item.state}
              </Badge>
              <CloseoutBadge
                closeoutState={item.closeout_state}
                className="px-1.5 py-0 text-[10px]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3 shrink-0" aria-hidden />
              <span className="font-mono">
                {item.account_label ?? "(account not recorded)"}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3 shrink-0" aria-hidden />
              <span className="truncate font-mono">
                {item.repo ?? "(no repo)"}
                {item.git_branch ? ` · ${item.git_branch}` : ""}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3 shrink-0" aria-hidden />
              {item.turn_count ?? "?"} turns · {formatBytes(item.byte_count)}
            </span>
          </div>

          {/* Attribution, digest claim and audit signal — always present.
              A row that shows none of them reads as "nothing to worry
              about", which is precisely what an unverified digest or a
              guessed tenant is not. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <TenantAttributionBadge
              tenantSource={item.tenant_source}
              tenantId={item.tenant_id}
            />
            <DigestBadge
              bodySource={item.body_source}
              contentSha256={item.content_sha256}
            />
            <SecretFindingsBadge
              count={item.secret_finding_count}
              kinds={item.secret_finding_kinds}
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-1 text-xs text-muted-foreground">
            <span
              className="truncate font-mono text-[10px]"
              title={item.claude_session_id}
            >
              {item.claude_session_id.slice(0, 8)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3 shrink-0" aria-hidden />
              {item.last_activity_at
                ? `active ${relativeTime(item.last_activity_at)}`
                : "no activity recorded"}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
