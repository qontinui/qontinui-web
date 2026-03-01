"use client";

import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { StepStatus } from "../execution-timeline-types";

export function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="size-3.5 text-red-500 shrink-0" />;
    case "running":
      return (
        <Loader2 className="size-3.5 text-blue-400 animate-spin shrink-0" />
      );
    case "skipped":
      return <div className="size-3.5 rounded-full bg-zinc-600 shrink-0" />;
    default:
      return (
        <div className="size-3.5 rounded-full bg-border-subtle shrink-0" />
      );
  }
}
