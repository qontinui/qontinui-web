"use client";

/** A state shown as an icon AND words — never colour alone. */

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { StatusTone } from "../_lib/spend";

const TONE: Record<StatusTone, { icon: LucideIcon; className: string }> = {
  good: { icon: CheckCircle2, className: "text-success" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  critical: { icon: XCircle, className: "text-error" },
  neutral: { icon: CircleDashed, className: "text-muted-foreground" },
};

export function StatusBadge({
  label,
  tone,
  uiBridgeId,
}: {
  label: string;
  tone: StatusTone;
  uiBridgeId?: string;
}) {
  const { icon: Icon, className } = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${className}`}
      data-ui-bridge-id={uiBridgeId}
      data-tone={tone}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="text-foreground">{label}</span>
    </span>
  );
}
