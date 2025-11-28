"use client";

import React from "react";
import { Eye, Image, Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type {
  VisualizationModeSelectorProps,
  VisualizationMode,
} from "@/types/integration-tests";

export const VisualizationModeSelector: React.FC<
  VisualizationModeSelectorProps
> = ({ mode, onModeChange, disabled = false }) => {
  const visualizationModes: Array<{
    value: VisualizationMode;
    label: string;
    description: string;
    icon: React.ReactNode;
    recommended?: boolean;
  }> = [
    {
      value: "none",
      label: "None (Immediate)",
      description:
        "Run tests immediately without visual feedback. Fastest execution.",
      icon: <Eye className="w-4 h-4" />,
      recommended: true,
    },
    {
      value: "screenshots",
      label: "Screenshots",
      description:
        "Capture screenshots at each step. Good for debugging failures.",
      icon: <Image className="w-4 h-4" />,
    },
    {
      value: "state-visualization",
      label: "State Visualization",
      description:
        "Show state transitions with fixed positions. Best for understanding flow.",
      icon: <Network className="w-4 h-4" />,
    },
  ];

  return (
    <Card className="bg-white border border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Visualization
          <span className="text-xs font-normal text-gray-500">(optional)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={mode}
          onValueChange={(value) => onModeChange(value as VisualizationMode)}
          disabled={disabled}
          className="space-y-3"
        >
          {visualizationModes.map((vizMode) => (
            <div
              key={vizMode.value}
              className={`relative flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                mode === vizMode.value
                  ? "bg-blue-50 border-blue-300 shadow-sm"
                  : "bg-white border-gray-200 hover:bg-gray-50"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              onClick={() => !disabled && onModeChange(vizMode.value)}
            >
              <RadioGroupItem
                value={vizMode.value}
                id={vizMode.value}
                className="mt-1"
                disabled={disabled}
              />
              <div className="flex-1">
                <Label
                  htmlFor={vizMode.value}
                  className={`flex items-center gap-2 cursor-pointer ${
                    disabled ? "cursor-not-allowed" : ""
                  }`}
                >
                  <div
                    className={`p-1.5 rounded ${
                      mode === vizMode.value
                        ? "bg-blue-100 text-blue-600"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {vizMode.icon}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{vizMode.label}</span>
                    {vizMode.recommended && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        Recommended
                      </span>
                    )}
                  </div>
                </Label>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  {vizMode.description}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>

        {/* Info Note */}
        <div className="mt-4 pt-3 border-t">
          <p className="text-xs text-gray-500 leading-relaxed">
            Visualization mode affects execution speed. &quot;None&quot; is
            fastest for quick feedback, while visual modes help with debugging
            and understanding test behavior.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default VisualizationModeSelector;
