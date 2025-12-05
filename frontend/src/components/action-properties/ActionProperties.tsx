"use client";

import { useRef, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { actionConfigRegistry } from "./ActionConfigRegistry";
import { Action } from "./types";
import { ActionExpectationsEditor } from "@/components/expectations/ActionExpectationsEditor";
import { ActionExpectations } from "@/lib/expectations";
import "./actions"; // Import to trigger registration

interface ActionPropertiesProps {
  action: Action | null;
  onUpdateAction: (action: Action) => void;
}

/**
 * Main ActionProperties component - uses component registry pattern.
 *
 * This component has been refactored to use a registry-based architecture
 * instead of a large switch statement, reducing code size and improving
 * maintainability.
 */
export function ActionProperties({
  action,
  onUpdateAction,
}: ActionPropertiesProps) {
  const { images, updateImageUsage, removeImageUsage, states, workflows } =
    useAutomation();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [shouldOpenImageSelector, setShouldOpenImageSelector] = useState(false);

  // Detect when a new FIND action is selected without an image
  useEffect(() => {
    if (action && action.type === "FIND" && !action.config.image) {
      setShouldOpenImageSelector(true);
    } else {
      setShouldOpenImageSelector(false);
    }
  }, [action?.id, action?.type]);

  if (!action) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Select an action</p>
          <p className="text-sm">to configure its properties</p>
        </div>
      </div>
    );
  }

  const updateConfig = (
    key: string,
    value: any,
    additionalUpdates: Record<string, any> = {}
  ) => {
    // Special case: reset entire config to new value
    if (key === "__reset__") {
      const updatedAction = {
        ...action,
        config: value,
      };
      onUpdateAction(updatedAction);
      return;
    }

    // Special case: update base settings (pause timing, etc.)
    if (key === "__base__") {
      const updatedAction = {
        ...action,
        base: value,
      };
      onUpdateAction(updatedAction);
      return;
    }

    if (key === "image") {
      // Remove old image usage
      if (action.config.image) {
        removeImageUsage(action.config.image, action.id);
      }
      // Add new image usage
      if (value) {
        updateImageUsage(value, {
          type: "process",
          id: action.id,
          name: `${action.type} Action`,
        });
      }
      // Clear removedImage marker when selecting a new image
      if (action.config.removedImage) {
        additionalUpdates.removedImage = undefined;
      }
    }

    const updatedAction = {
      ...action,
      config: {
        ...action.config,
        [key]: value,
        ...additionalUpdates, // Merge any additional config updates
      },
    };
    onUpdateAction(updatedAction);
  };

  // Look up the component for this action type
  const PropertiesComponent = actionConfigRegistry.getComponent(action.type);

  // If no component found, show default message
  if (!PropertiesComponent) {
    return (
      <div className="space-y-4">
        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-[#00D9FF]">
              {action.type} Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              Properties for {action.type} action
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleExpectationsChange = (expectations: ActionExpectations) => {
    const updatedAction = {
      ...action,
      expectations,
    };
    onUpdateAction(updatedAction);
  };

  return (
    <div className="space-y-4">
      <Card className="border-gray-700 bg-[#27272A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-[#00D9FF]">
            {action.type} Properties
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PropertiesComponent
            action={action}
            updateConfig={updateConfig}
            images={images}
            states={states}
            processes={workflows}
            textAreaRef={textAreaRef}
            shouldOpenImageSelector={shouldOpenImageSelector}
            onUpdateAction={onUpdateAction}
          />
        </CardContent>
      </Card>

      <ActionExpectationsEditor
        expectations={action.expectations}
        onChange={handleExpectationsChange}
      />
    </div>
  );
}
