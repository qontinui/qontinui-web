import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight, Sliders } from "lucide-react";

interface AdvancedSettingsCardProps {
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  initialStates: string;
  onInitialStatesChange: (value: string) => void;
  autoMinimize: boolean;
  onAutoMinimizeChange: (value: boolean) => void;
}

export function AdvancedSettingsCard({
  showAdvanced,
  onToggleAdvanced,
  initialStates,
  onInitialStatesChange,
  autoMinimize,
  onAutoMinimizeChange,
}: AdvancedSettingsCardProps) {
  return (
    <Card className="bg-muted border-border">
      <CardHeader className="cursor-pointer py-3" onClick={onToggleAdvanced}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {showAdvanced ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <Sliders className="size-4" />
            Advanced Settings
          </CardTitle>
        </div>
      </CardHeader>
      {showAdvanced && (
        <CardContent className="space-y-4 pt-0">
          <div className="space-y-2">
            <Label className="text-sm">Initial States</Label>
            <Input
              placeholder="Comma-separated state names (optional)"
              value={initialStates}
              onChange={(e) => onInitialStatesChange(e.target.value)}
              className="bg-background border-border"
            />
            <p className="text-xs text-muted-foreground">
              Override the starting states for execution
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto-Minimize</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Minimize the runner window during execution
              </p>
            </div>
            <Switch
              checked={autoMinimize}
              onCheckedChange={onAutoMinimizeChange}
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
