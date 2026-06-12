"use client";

/**
 * Coord mutation-control gate.
 *
 * Non-administrator tenant members (the "Developer" tier) may VIEW the
 * AI-Dev coordination pages but must NOT see/use mutation controls. Wrap any
 * mutating control (kill-switch, rollout promote, plan transition, gate
 * approve/reject, tenant-config writes) in {@link CoordAdminOnly} so it only
 * renders for coord admins (`useAuth().isCoordAdmin`).
 *
 * The backend ALSO enforces admin (403 on the mutating endpoints), so this is
 * a UX layer — it keeps the surface honest by not showing controls a Developer
 * can't use.
 *
 * Usage:
 *   <CoordAdminOnly>
 *     <Button onClick={fire}>Fire kill switch</Button>
 *   </CoordAdminOnly>
 *
 * Optionally render a muted "Administrator only" note in place of the hidden
 * control via `fallback` (e.g. so a Developer understands why an action area
 * is empty):
 *   <CoordAdminOnly fallback={<ReadOnlyNotice />}> … </CoordAdminOnly>
 */

import React from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

export function CoordAdminOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isCoordAdmin } = useAuth();
  if (!isCoordAdmin) return <>{fallback}</>;
  return <>{children}</>;
}

/**
 * Small muted inline note explaining a control is admin-gated. Use as the
 * `fallback` of {@link CoordAdminOnly} where a visible "why is this empty?"
 * cue helps the Developer-tier viewer.
 */
export function ReadOnlyNotice({ label = "Administrator only" }: { label?: string }) {
  return (
    <p
      className="text-xs text-muted-foreground flex items-center gap-1"
      data-testid="coord-admin-only-notice"
    >
      <Lock className="h-3 w-3" />
      {label}
    </p>
  );
}
