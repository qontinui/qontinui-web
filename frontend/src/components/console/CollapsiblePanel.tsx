"use client";

/**
 * CollapsiblePanel — a fleet/operations dashboard section that collapses to a
 * single header row while keeping its status summary visible.
 *
 * **Enforces R7 — "Secondary material collapses, but its signal does not."**
 * See `frontend/docs/console-ui-style-guide.md` §2 R7 and §3.2.
 *
 * MOVED from `components/operations/` into `components/console/` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1 (D3),
 * **unchanged**. Phase 1 left a re-export shim behind at
 * `components/operations/CollapsiblePanel` to spare that PR a repo-wide import
 * churn, on the stated condition that it be deleted "once the console migration
 * (Phase 3) has rewritten the last caller". Phase 3 landed and rewrote none of
 * them: every caller of the shim lived in `components/operations/`, which no
 * wave's route census covered, so the condition fired with nobody watching it.
 * The seven callers were repointed here and the shim deleted as Phase 1's
 * post-merge follow-up. `components/operations/index.ts` still re-exports this
 * symbol — that is the barrel, not the shim, and it is intentional.
 *
 * Designed for monitoring surfaces: when collapsed, the header still shows the
 * `summary` (counts / status badges) so a red/blocked state never hides behind
 * a click — you only fold away the detail rows, not the signal. The open/closed
 * choice persists per `storageKey` in localStorage so an operator's layout
 * survives reloads.
 *
 * Chrome matches the existing section tiles (`DevActionsTile` /
 * `MigrationQueueTile`): `rounded-lg border bg-card/30 p-4`. Arbitrary
 * `data-*` props (e.g. `data-ui-bridge-id`, `data-testid`) are forwarded to the
 * root so UI-Bridge / spec-CI element hooks are preserved across the wrap.
 *
 * - `title` / `icon` — left side of the header (inside the toggle).
 * - `summary` — badges shown next to the title, visible even when collapsed.
 * - `headerActions` — controls on the right (refresh, inputs); rendered OUTSIDE
 *   the toggle so clicking them never folds the panel.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsiblePanelProps {
  title: ReactNode;
  /**
   * Element wrapping `title`. Defaults to `h2` — the panel is a SECTION on
   * every surface that predates this prop, and a section deserves a heading.
   *
   * Pass `"div"` when the panel is a ROW in a list of them: the coord Alerts
   * tab renders up to 100 of these under one page heading, and 100 sibling
   * `<h2>`s make the document outline useless to a screen-reader user (the
   * trigger is a button whose accessible name already carries the title, so
   * nothing is lost). Chrome is identical either way.
   */
  titleAs?: "h2" | "h3" | "div";
  icon?: ReactNode;
  /** Status badges/counts kept visible in the header even when collapsed. */
  summary?: ReactNode;
  /** Right-side controls (refresh, inputs). Rendered outside the toggle. */
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  /** localStorage key persisting the open/closed choice across reloads. */
  storageKey?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
  "data-testid"?: string;
  "data-ui-bridge-id"?: string;
}

export function CollapsiblePanel({
  title,
  titleAs: TitleTag = "h2",
  icon,
  summary,
  headerActions,
  defaultOpen = true,
  storageKey,
  className,
  contentClassName,
  children,
  ...rest
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Hydrate the persisted choice AFTER mount so the SSR/first-client render
  // matches `defaultOpen` (no hydration mismatch); then reconcile to storage.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === "0") setOpen(false);
      else if (v === "1") setOpen(true);
    } catch {
      /* localStorage unavailable (private mode / SSR) — keep defaultOpen. */
    }
  }, [storageKey]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* ignore persistence failures — collapse still works in-session. */
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn(
        "rounded-lg border border-border bg-card/30 p-4",
        className
      )}
      {...rest}
    >
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="flex items-center gap-2 min-w-0 text-left">
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground shrink-0 transition-transform",
              !open && "-rotate-90"
            )}
            aria-hidden
          />
          {icon}
          <TitleTag className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            {title}
          </TitleTag>
          {summary}
        </CollapsibleTrigger>
        {headerActions && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {headerActions}
          </div>
        )}
      </div>
      <CollapsibleContent className={cn("mt-3", contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
