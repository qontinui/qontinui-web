import { useState } from "react";
import { ActionSnapshot } from "../../../lib/integration-testing-framework";
import { ActionConfigState } from "../types";

const ACTION_TYPES: ActionSnapshot["actionType"][] = [
  "FIND",
  "CLICK",
  "TYPE",
  "DRAG",
  "SCROLL",
];

const DEFAULT_CONFIG: ActionConfigState = {
  similarity: 0.8,
  waitTime: 0,
  mouseButton: "LEFT",
  offset: { x: 0, y: 0 },
};

export function useActionConfig() {
  const [actionType, setActionType] =
    useState<ActionSnapshot["actionType"]>("FIND");
  const [actionConfig, setActionConfig] =
    useState<ActionConfigState>(DEFAULT_CONFIG);
  const [text, setText] = useState("");

  const updateConfig = (updates: Partial<ActionConfigState>) => {
    setActionConfig((prev) => ({ ...prev, ...updates }));
  };

  const updateOffset = (axis: "x" | "y", value: number) => {
    setActionConfig((prev) => ({
      ...prev,
      offset: { ...prev.offset, [axis]: value },
    }));
  };

  return {
    actionType,
    setActionType,
    actionConfig,
    updateConfig,
    updateOffset,
    text,
    setText,
    actionTypes: ACTION_TYPES,
  };
}
