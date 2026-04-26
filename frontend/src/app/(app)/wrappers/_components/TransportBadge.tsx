"use client";

import React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WrapperTransport } from "../_api";

interface TransportBadgeProps {
  transport: WrapperTransport;
  className?: string;
}

const STYLES: Record<WrapperTransport, string> = {
  api: "bg-cyan-500/10 text-cyan-300 border-cyan-500/40",
  headless: "bg-purple-500/10 text-purple-300 border-purple-500/40",
  headed: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  live: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
};

const LABELS: Record<WrapperTransport, string> = {
  api: "API",
  headless: "Headless",
  headed: "Headed",
  live: "Live",
};

export function TransportBadge({ transport, className }: TransportBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] uppercase tracking-wide",
        STYLES[transport],
        className
      )}
    >
      {LABELS[transport]}
    </Badge>
  );
}
