import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Activity, Wrench } from "lucide-react";

interface PageHeaderProps {
  isGuiLocked: boolean;
  showToolkit: boolean;
  onToggleToolkit: () => void;
}

export function PageHeader({
  isGuiLocked,
  showToolkit,
  onToggleToolkit,
}: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <Zap className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">
          Visual Automation
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {isGuiLocked && (
          <Badge variant="warning" className="gap-1.5">
            <Activity className="w-3 h-3 animate-pulse" />
            GUI In Use
          </Badge>
        )}
        <Badge variant="success" className="gap-1.5">
          <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
          Runner Connected
        </Badge>
        <Button
          variant={showToolkit ? "default" : "outline"}
          size="sm"
          onClick={onToggleToolkit}
          className={showToolkit ? "bg-primary text-black" : "border-border"}
        >
          <Wrench className="size-4 mr-1" />
          Toolkit
        </Button>
      </div>
    </header>
  );
}
