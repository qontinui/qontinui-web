import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, Zap, Wrench } from "lucide-react";
import { toast } from "sonner";
import { runnerApi } from "@/lib/runner-api";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

interface ToolkitPanelProps {
  toolkitTab: "actions" | "macros";
  onTabChange: (tab: "actions" | "macros") => void;
  clickType: string;
  onClickTypeChange: (type: string) => void;
  typeText: string;
  onTypeTextChange: (text: string) => void;
  hotkeyInput: string;
  onHotkeyInputChange: (input: string) => void;
  selectedWorkflow: UnifiedWorkflow | null;
}

export function ToolkitPanel({
  toolkitTab,
  onTabChange,
  clickType,
  onClickTypeChange,
  typeText,
  onTypeTextChange,
  hotkeyInput,
  onHotkeyInputChange,
  selectedWorkflow,
}: ToolkitPanelProps) {
  const handleTypeText = async () => {
    if (!typeText.trim()) {
      toast.error("Enter text to type");
      return;
    }
    try {
      await runnerApi.executeAction({
        action_type: "type",
        text_input: typeText,
      });
      toast.success("Text typed successfully");
      onTypeTextChange("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to type text");
    }
  };

  const handleHotkey = async () => {
    if (!hotkeyInput.trim()) {
      toast.error("Enter a hotkey combination");
      return;
    }
    try {
      await runnerApi.executeAction({
        action_type: "hotkey",
        hotkey: hotkeyInput,
      });
      toast.success("Hotkey executed successfully");
      onHotkeyInputChange("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to execute hotkey"
      );
    }
  };

  return (
    <div className="w-80 shrink-0 space-y-4">
      <Card className="bg-muted border-border sticky top-24">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="size-4" />
            Automation Toolkit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-1">
            <Button
              variant={toolkitTab === "actions" ? "default" : "outline"}
              size="sm"
              onClick={() => onTabChange("actions")}
              className={`flex-1 text-xs ${toolkitTab === "actions" ? "bg-primary text-black" : ""}`}
            >
              Quick Actions
            </Button>
            <Button
              variant={toolkitTab === "macros" ? "default" : "outline"}
              size="sm"
              onClick={() => onTabChange("macros")}
              className={`flex-1 text-xs ${toolkitTab === "macros" ? "bg-primary text-black" : ""}`}
            >
              Macros
            </Button>
          </div>

          {toolkitTab === "actions" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Click Type</Label>
                <div className="grid grid-cols-3 gap-1">
                  {["click", "double", "right"].map((type) => (
                    <Button
                      key={type}
                      variant={clickType === type ? "default" : "outline"}
                      size="sm"
                      onClick={() => onClickTypeChange(type)}
                      className={`text-xs capitalize ${clickType === type ? "bg-primary text-black" : ""}`}
                    >
                      {type}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs mt-1"
                  onClick={() => {
                    if (!selectedWorkflow) {
                      toast.warning("Load a config first to use click actions");
                    } else {
                      toast.warning(
                        "Image target selection not yet available. Use click actions from a workflow."
                      );
                    }
                  }}
                >
                  <Play className="size-3 mr-1" />
                  Execute {clickType} click
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Type Text</Label>
                <div className="flex gap-1">
                  <Input
                    placeholder="Text to type..."
                    value={typeText}
                    onChange={(e) => onTypeTextChange(e.target.value)}
                    className="bg-background border-border text-xs"
                  />
                  <Button variant="outline" size="sm" onClick={handleTypeText}>
                    <Play className="size-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Hotkey</Label>
                <div className="flex gap-1">
                  <Input
                    placeholder="e.g. ctrl+s"
                    value={hotkeyInput}
                    onChange={(e) => onHotkeyInputChange(e.target.value)}
                    className="bg-background border-border text-xs font-mono"
                  />
                  <Button variant="outline" size="sm" onClick={handleHotkey}>
                    <Play className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {toolkitTab === "macros" && (
            <div className="text-center py-6">
              <Zap className="size-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                No macros available.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Create macros in the Build section.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
