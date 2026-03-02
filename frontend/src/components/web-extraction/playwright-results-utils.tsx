import { Shield, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

export function getRiskIcon(risk: string) {
  switch (risk.toLowerCase()) {
    case "safe":
      return <ShieldCheck className="h-4 w-4 text-green-500" />;
    case "caution":
      return <Shield className="h-4 w-4 text-yellow-500" />;
    case "dangerous":
      return <ShieldAlert className="h-4 w-4 text-orange-500" />;
    case "blocked":
      return <ShieldX className="h-4 w-4 text-red-500" />;
    default:
      return <Shield className="h-4 w-4 text-muted-foreground" />;
  }
}

export function getRiskBadgeVariant(
  risk: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (risk.toLowerCase()) {
    case "safe":
      return "default";
    case "caution":
      return "secondary";
    case "dangerous":
    case "blocked":
      return "destructive";
    default:
      return "outline";
  }
}
