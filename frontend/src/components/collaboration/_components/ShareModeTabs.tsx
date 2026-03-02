import { Mail, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareModeTabsProps {
  shareMode: "user" | "organization";
  onShareModeChange: (mode: "user" | "organization") => void;
}

export function ShareModeTabs({
  shareMode,
  onShareModeChange,
}: ShareModeTabsProps) {
  return (
    <div className="flex gap-2 p-1 bg-muted rounded-lg">
      <Button
        variant={shareMode === "user" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onShareModeChange("user")}
        className="flex-1"
      >
        <Mail className="mr-2 h-4 w-4" />
        Specific User
      </Button>
      <Button
        variant={shareMode === "organization" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onShareModeChange("organization")}
        className="flex-1"
      >
        <Building2 className="mr-2 h-4 w-4" />
        Organization
      </Button>
    </div>
  );
}
