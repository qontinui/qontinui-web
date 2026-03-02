import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertCircle,
  Info,
} from "lucide-react";

export function getSeverityIcon(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <ShieldAlert className="size-4 text-red-500" />;
    case "high":
      return <ArrowUpCircle className="size-4 text-orange-500" />;
    case "medium":
      return <AlertCircle className="size-4 text-yellow-500" />;
    case "low":
      return <ArrowDownCircle className="size-4 text-blue-400" />;
    default:
      return <Info className="size-4 text-muted-foreground" />;
  }
}

export function getSeverityBadge(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "high":
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          High
        </Badge>
      );
    case "medium":
      return <Badge variant="warning">Medium</Badge>;
    case "low":
      return <Badge variant="info">Low</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}
