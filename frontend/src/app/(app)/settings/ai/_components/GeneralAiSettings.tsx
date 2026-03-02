import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Video, MessageSquare } from "lucide-react";

interface GeneralAiSettingsProps {
  autoRefineVideoIterations: number;
  onAutoRefineVideoIterationsChange: (value: number) => void;
  interactiveSessionsEnabled: boolean;
  onInteractiveSessionsEnabledChange: (value: boolean) => void;
}

export function GeneralAiSettings({
  autoRefineVideoIterations,
  onAutoRefineVideoIterationsChange,
  interactiveSessionsEnabled,
  onInteractiveSessionsEnabledChange,
}: GeneralAiSettingsProps) {
  return (
    <>
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Video className="size-4" />
            Auto-Refine Defaults
          </h3>
        </div>
        <div className="p-4">
          <div className="space-y-2">
            <Label>Include Video After Iterations</Label>
            <Input
              type="number"
              min={0}
              max={20}
              value={autoRefineVideoIterations}
              onChange={(e) =>
                onAutoRefineVideoIterationsChange(Number(e.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">
              Number of iterations before including video context for
              auto-refinement. Set to 0 to always include video.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="size-4" />
            Session Mode
          </h3>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Interactive Sessions</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable interactive mode for AI sessions
              </p>
            </div>
            <Switch
              checked={interactiveSessionsEnabled}
              onCheckedChange={onInteractiveSessionsEnabledChange}
            />
          </div>
        </div>
      </div>
    </>
  );
}
