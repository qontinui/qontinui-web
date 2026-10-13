"use client";

/**
 * ActionItemRow — one operator action item on one line, with its detail (the
 * body, links, source, push delivery and the Done / Dismiss buttons) behind a
 * click.
 *
 * Plan `2026-10-12-operator-action-items-pushed-to-the-phone` Phase 3,
 * composed from `components/console` per `frontend/docs/console-ui-style-guide.md`
 * (R2 one line, R4 accent from `attention`, R5 detail in place, R8 raw ids only
 * in the detail's last line). Derivations live in `actionItemStatus.ts`.
 *
 * Links: an `https:` link opens in a new tab; a `qontinui://` app route only
 * means something on the phone, so it renders as text with "Open on phone";
 * any other scheme is never made clickable.
 */

import { Button } from "@/components/ui/button";
import { ExternalLink, Smartphone } from "lucide-react";
import {
  BackendErrorMessage,
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import {
  ACTION_ITEM_STATUS_PALETTE,
  deriveActionItemStatus,
  presentLink,
  pushLabel,
  pushRemedy,
  resolvedSentence,
  sourceChip,
  sourceSentence,
  type ActionItemResolution,
  type CoordActionItem,
} from "./actionItemStatus";

export interface ActionItemRowProps {
  item: CoordActionItem;
  expanded: boolean;
  onToggle: () => void;
  /** Resolve this item; the page owns the request and the refresh. */
  onResolve: (item: CoordActionItem, status: ActionItemResolution) => void;
  /** True while a resolve for THIS item is in flight. */
  resolving: boolean;
  /** The last resolve refusal for THIS item, if any. */
  resolveError: unknown;
}

function PushDetail({ item }: { item: CoordActionItem }) {
  const push = item.push;
  const remedy = pushRemedy(push?.state);
  const detail = push?.detail ?? {};
  const httpStatus = detail["http_status"];
  const accepted = detail["accepted"];
  const devices = detail["devices"];
  return (
    <div className="text-xs space-y-1" data-testid="action-item-push">
      <p>
        <span className="text-muted-foreground">Phone: </span>
        <span data-testid="action-item-push-state">
          {pushLabel(push?.state)}
        </span>
        {typeof devices === "number" && (
          <span className="text-muted-foreground">
            {" "}
            · {devices} device{devices === 1 ? "" : "s"}
          </span>
        )}
        {typeof accepted === "number" && (
          <span className="text-muted-foreground"> · {accepted} accepted</span>
        )}
        {typeof httpStatus === "number" && (
          <span className="text-muted-foreground"> · HTTP {httpStatus}</span>
        )}
        {push && push.attempts > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {push.attempts} attempt{push.attempts === 1 ? "" : "s"}
          </span>
        )}
      </p>
      {item.status === "open" && remedy && (
        <p className="text-red-300/90" data-testid="action-item-push-remedy">
          {remedy}
        </p>
      )}
      {push?.next_attempt_at && item.status === "open" && (
        <p className="text-muted-foreground">
          next attempt{" "}
          <RowTime
            at={push.next_attempt_at}
            verb="Next attempt"
            className="inline"
          />
        </p>
      )}
    </div>
  );
}

function Links({ item }: { item: CoordActionItem }) {
  if (!item.links || item.links.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm" data-testid="action-item-links">
      {item.links.map((link, i) => {
        const shown = presentLink(link.url);
        const key = `${i}:${link.url}`;
        if (shown.kind === "web") {
          return (
            <li key={key}>
              <a
                href={shown.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                data-testid="action-item-link-web"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </li>
          );
        }
        if (shown.kind === "app") {
          return (
            <li
              key={key}
              className="inline-flex items-center gap-1 text-muted-foreground"
              data-testid="action-item-link-app"
              title={shown.route}
            >
              <Smartphone className="h-3 w-3" aria-hidden />
              {link.label} — Open on phone
            </li>
          );
        }
        return (
          <li
            key={key}
            className="text-muted-foreground"
            data-testid="action-item-link-text"
          >
            {link.label}: {link.url}
          </li>
        );
      })}
    </ul>
  );
}

export function ActionItemRow({
  item,
  expanded,
  onToggle,
  onResolve,
  resolving,
  resolveError,
}: ActionItemRowProps) {
  const status = deriveActionItemStatus(item);
  const isOpen = item.status === "open";
  return (
    <RecordRow
      data-testid={`action-item-${item.item_id}`}
      rowKey={item.item_id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={sourceChip(item.source_kind)}
      label={
        <span title={item.title} data-testid="action-item-title">
          {item.title}
        </span>
      }
      status={
        <StatusBadge status={status} palette={ACTION_ITEM_STATUS_PALETTE} />
      }
      reason={status.reason}
      time={
        <RowTime
          at={isOpen ? item.created_at : (item.resolved_at ?? item.updated_at)}
          verb={isOpen ? "Raised" : "Resolved"}
        />
      }
    >
      <RecordDetail
        data-testid="action-item-detail"
        why={
          item.body ? (
            <p
              className="text-sm text-foreground whitespace-pre-wrap"
              data-testid="action-item-body"
            >
              {item.body}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No further detail — the title is the whole ask.
            </p>
          )
        }
        problems={<PushDetail item={item} />}
        actions={
          <div className="space-y-2">
            <Links item={item} />
            {isOpen ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => onResolve(item, "done")}
                  disabled={resolving}
                  data-testid={`action-item-done-${item.item_id}`}
                >
                  Done
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve(item, "dismissed")}
                  disabled={resolving}
                  data-testid={`action-item-dismiss-${item.item_id}`}
                >
                  Dismiss
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {resolvedSentence(item)}
              </p>
            )}
            {resolveError != null && (
              <p
                className="text-xs text-destructive"
                data-testid="action-item-resolve-error"
              >
                <BackendErrorMessage error={resolveError} />
              </p>
            )}
          </div>
        }
        history={
          <p className="text-xs text-muted-foreground">
            {sourceSentence(item.source_kind)} Raised{" "}
            <RowTime at={item.created_at} verb="Raised" className="inline" />
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            item: {item.item_id} · created by: {item.created_by} · push state:{" "}
            {item.push?.state ?? "?"}
            {item.push && Object.keys(item.push.detail ?? {}).length > 0
              ? ` · push detail: ${JSON.stringify(item.push.detail)}`
              : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
