"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function SubscriptionBadge() {
  return (
    <Badge
      variant="outline"
      className={cn(
        "flex items-center gap-1.5 px-3 py-1",
        "bg-blue-500/20 text-blue-400 border-blue-500/30"
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className="font-medium">Free</span>
    </Badge>
  );
}
