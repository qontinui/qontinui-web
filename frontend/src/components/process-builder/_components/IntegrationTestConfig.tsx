"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import { Camera } from "lucide-react";
import type { Workflow } from "@/lib/action-schema/action-types";

interface Screenshot {
  id: string;
  name: string;
}

interface State {
  id: string;
  name: string;
}

interface IntegrationTestConfigProps {
  selectedProcess: Workflow;
  screenshots: Screenshot[];
  states: State[];
  onUpdateProcess: (updated: Workflow) => void;
}

export function IntegrationTestConfig({
  selectedProcess,
  screenshots,
  states,
  onUpdateProcess,
}: IntegrationTestConfigProps) {
  return (
    <Card className="border-border-default bg-surface-raised/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-text-muted">
          Integration Test Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Initial Screenshot */}
        <div className="space-y-2">
          <Label className="text-sm text-text-muted">Initial Screenshot</Label>
          <div className="flex items-center gap-2">
            <ScreenshotSelector
              selectedScreenshot={selectedProcess.initialScreenshotId || ""}
              onSelectScreenshot={(screenshotId) => {
                const updated = {
                  ...selectedProcess,
                  initialScreenshotId: screenshotId,
                };
                onUpdateProcess(updated);
              }}
              trigger={
                <Button
                  variant="outline"
                  className="w-full justify-start border-border-default bg-transparent hover:bg-surface-raised"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  {selectedProcess.initialScreenshotId
                    ? screenshots.find(
                        (s) => s.id === selectedProcess.initialScreenshotId
                      )?.name || "Select screenshot"
                    : "Select screenshot"}
                </Button>
              }
            />
            {selectedProcess.initialScreenshotId && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const updated = {
                    ...selectedProcess,
                    initialScreenshotId: undefined,
                  };
                  onUpdateProcess(updated);
                }}
                className="hover:bg-surface-raised"
              >
                ×
              </Button>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Screenshot to start the test with
          </p>
        </div>

        {/* Initial Active States */}
        <div className="space-y-2">
          <Label className="text-sm text-text-muted">
            Initial Active States
          </Label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {states.length === 0 ? (
              <p className="text-xs text-text-muted">No states defined yet</p>
            ) : (
              states.map((state) => (
                <div key={state.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`state-${state.id}`}
                    checked={
                      selectedProcess.initialStateIds?.includes(state.id) ||
                      false
                    }
                    onCheckedChange={(checked) => {
                      const currentIds = selectedProcess.initialStateIds || [];
                      const updated = {
                        ...selectedProcess,
                        initialStateIds: checked
                          ? [...currentIds, state.id]
                          : currentIds.filter((id) => id !== state.id),
                      };
                      onUpdateProcess(updated);
                    }}
                    className="border-border-default data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary"
                  />
                  <Label
                    htmlFor={`state-${state.id}`}
                    className="text-sm font-normal text-text-secondary cursor-pointer"
                  >
                    {state.name}
                  </Label>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-text-muted">
            States that should be active at test start
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
