import { useState, useCallback } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("useWorkflowVariables");

export function useWorkflowVariables() {
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [newVarScope, setNewVarScope] = useState<
    "local" | "process" | "global"
  >("local");

  const updateVariable = useCallback(
    (scope: string, name: string, value: unknown) => {
      log.debug("Update variable:", scope, name, value);
    },
    []
  );

  const addVariable = useCallback(() => {
    if (newVarName.trim()) {
      updateVariable(newVarScope, newVarName, newVarValue);
      setNewVarName("");
      setNewVarValue("");
    }
  }, [newVarName, newVarScope, newVarValue, updateVariable]);

  const removeVariable = useCallback((scope: string, name: string) => {
    log.debug("Remove variable:", scope, name);
  }, []);

  return {
    newVarName,
    setNewVarName,
    newVarValue,
    setNewVarValue,
    newVarScope,
    setNewVarScope,
    addVariable,
    removeVariable,
  };
}
