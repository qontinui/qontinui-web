"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Camera, ChevronDown, ChevronUp, Info } from "lucide-react";
import { toast } from "sonner";

export interface ScreenshotFilter {
  eventTypes: string[];
  buttons: string[];
  maxCount: number;
  includeAfterDelayMs?: number;
}

export interface ScreenshotRequestPanelProps {
  sessionId: string;
  onRequest: (filter: ScreenshotFilter) => void;
}

const EVENT_TYPE_OPTIONS = [
  {
    value: "mouse_click",
    label: "Mouse Clicks",
    description: "Capture on click events",
  },
  {
    value: "mouse_drag",
    label: "Mouse Drags",
    description: "Capture during drag operations",
  },
  {
    value: "key_press",
    label: "Key Presses",
    description: "Capture on keyboard input",
  },
  {
    value: "scroll",
    label: "Scrolls",
    description: "Capture on scroll events",
  },
];

const BUTTON_OPTIONS = [
  { value: "left", label: "Left Click" },
  { value: "right", label: "Right Click" },
  { value: "middle", label: "Middle Click" },
];

export const ScreenshotRequestPanel: React.FC<ScreenshotRequestPanelProps> = ({
  onRequest,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [eventTypes, setEventTypes] = useState<string[]>(["mouse_click"]);
  const [buttons, setButtons] = useState<string[]>(["left"]);
  const [maxCount, setMaxCount] = useState(10);
  const [includeAfterDelay, setIncludeAfterDelay] = useState(false);
  const [afterDelayMs, setAfterDelayMs] = useState(500);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEventTypeToggle = (value: string) => {
    if (eventTypes.includes(value)) {
      setEventTypes(eventTypes.filter((t) => t !== value));
    } else {
      setEventTypes([...eventTypes, value]);
    }
  };

  const handleButtonToggle = (value: string) => {
    if (buttons.includes(value)) {
      setButtons(buttons.filter((b) => b !== value));
    } else {
      setButtons([...buttons, value]);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (eventTypes.length === 0) {
      toast.error("Please select at least one event type");
      return;
    }

    if (maxCount < 1 || maxCount > 1000) {
      toast.error("Max count must be between 1 and 1000");
      return;
    }

    // Only validate buttons if mouse_click is selected
    if (eventTypes.includes("mouse_click") && buttons.length === 0) {
      toast.error("Please select at least one mouse button");
      return;
    }

    try {
      setIsSubmitting(true);

      const filter: ScreenshotFilter = {
        eventTypes,
        buttons,
        maxCount,
        includeAfterDelayMs: includeAfterDelay ? afterDelayMs : undefined,
      };

      await onRequest(filter);

      toast.success("Screenshot request submitted successfully");
    } catch (error) {
      console.error("Failed to submit screenshot request:", error);
      toast.error("Failed to submit screenshot request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setEventTypes(["mouse_click"]);
    setButtons(["left"]);
    setMaxCount(10);
    setIncludeAfterDelay(false);
    setAfterDelayMs(500);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">
                  Request Full-Size Screenshots
                </CardTitle>
              </div>
              {isOpen ? (
                <ChevronUp className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              )}
            </div>
            <CardDescription>
              Generate high-resolution screenshots for specific events
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {/* Info Banner */}
            <div className="flex gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-medium mb-1">About Screenshot Requests</p>
                <p className="text-blue-800">
                  Full-size screenshots are generated asynchronously and will be
                  available in the screenshots tab once processing is complete.
                  This is useful for detailed analysis or documentation.
                </p>
              </div>
            </div>

            {/* Event Types */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Event Types</Label>
              <p className="text-sm text-gray-600">
                Select which types of events should trigger screenshot capture
              </p>
              <div className="space-y-2">
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Checkbox
                      id={`event-${option.value}`}
                      checked={eventTypes.includes(option.value)}
                      onCheckedChange={() =>
                        handleEventTypeToggle(option.value)
                      }
                    />
                    <div className="flex-1">
                      <label
                        htmlFor={`event-${option.value}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {option.label}
                      </label>
                      <p className="text-xs text-gray-500">
                        {option.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mouse Buttons (only shown if mouse_click is selected) */}
            {eventTypes.includes("mouse_click") && (
              <div className="space-y-3">
                <Label className="text-base font-semibold">Mouse Buttons</Label>
                <p className="text-sm text-gray-600">
                  Select which mouse buttons to capture
                </p>
                <div className="flex gap-2 flex-wrap">
                  {BUTTON_OPTIONS.map((option) => (
                    <Badge
                      key={option.value}
                      variant={
                        buttons.includes(option.value) ? "default" : "outline"
                      }
                      className="cursor-pointer px-3 py-2"
                      onClick={() => handleButtonToggle(option.value)}
                    >
                      {option.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Max Count */}
            <div className="space-y-3">
              <Label htmlFor="maxCount" className="text-base font-semibold">
                Maximum Screenshots
              </Label>
              <p className="text-sm text-gray-600">
                Limit the number of screenshots to generate (1-1000)
              </p>
              <Input
                id="maxCount"
                type="number"
                min={1}
                max={1000}
                value={maxCount}
                onChange={(e) => setMaxCount(parseInt(e.target.value) || 10)}
                className="w-32"
              />
            </div>

            {/* After Delay Option */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="includeAfterDelay"
                  checked={includeAfterDelay}
                  onCheckedChange={(checked) => setIncludeAfterDelay(!!checked)}
                />
                <div className="flex-1">
                  <Label
                    htmlFor="includeAfterDelay"
                    className="text-base font-semibold cursor-pointer"
                  >
                    Capture After Delay
                  </Label>
                  <p className="text-sm text-gray-600">
                    Also capture screenshots after a delay (useful for
                    animations or UI updates)
                  </p>
                </div>
              </div>

              {includeAfterDelay && (
                <div className="ml-7 space-y-2">
                  <Label htmlFor="afterDelayMs" className="text-sm">
                    Delay (milliseconds)
                  </Label>
                  <Input
                    id="afterDelayMs"
                    type="number"
                    min={0}
                    max={5000}
                    step={100}
                    value={afterDelayMs}
                    onChange={(e) =>
                      setAfterDelayMs(parseInt(e.target.value) || 500)
                    }
                    className="w-32"
                  />
                  <p className="text-xs text-gray-500">
                    Screenshots will be taken both immediately and after{" "}
                    {afterDelayMs}ms
                  </p>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="font-semibold text-sm mb-2">Request Summary</h4>
              <div className="text-sm space-y-1 text-gray-700">
                <p>
                  <span className="font-medium">Event Types:</span>{" "}
                  {eventTypes.length > 0
                    ? eventTypes
                        .map(
                          (t) =>
                            EVENT_TYPE_OPTIONS.find((o) => o.value === t)
                              ?.label || t
                        )
                        .join(", ")
                    : "None"}
                </p>
                {eventTypes.includes("mouse_click") && (
                  <p>
                    <span className="font-medium">Buttons:</span>{" "}
                    {buttons.length > 0
                      ? buttons
                          .map(
                            (b) =>
                              BUTTON_OPTIONS.find((o) => o.value === b)
                                ?.label || b
                          )
                          .join(", ")
                      : "None"}
                  </p>
                )}
                <p>
                  <span className="font-medium">Max Screenshots:</span>{" "}
                  {maxCount}
                </p>
                {includeAfterDelay && (
                  <p>
                    <span className="font-medium">After Delay:</span>{" "}
                    {afterDelayMs}ms
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || eventTypes.length === 0}
                className="flex-1"
              >
                <Camera className="h-4 w-4 mr-2" />
                {isSubmitting ? "Submitting..." : "Request Screenshots"}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
            </div>

            {/* Additional Info */}
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                Screenshots are processed in the background and may take several
                minutes depending on the number of events.
              </p>
              <p>
                You&apos;ll receive a notification when processing is complete,
                and screenshots will be available in the project&apos;s
                screenshots section.
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
