import { CalendarDays, CheckCircle2, CircleAlert, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Status } from "@/app/(app)/overview/types";

interface StatusPillProps {
  status: Status;
}

export function StatusPill({ status }: StatusPillProps) {
  const Icon =
    status === "Done"
      ? CheckCircle2
      : status === "At risk"
        ? CircleAlert
        : status === "In progress"
          ? TrendingUp
          : CalendarDays;

  return (
    <Badge
      variant={
        status === "At risk"
          ? "destructive"
          : status === "Done"
            ? "default"
            : "secondary"
      }
      className="gap-1"
    >
      <Icon className="size-3.5" />
      {status}
    </Badge>
  );
}
