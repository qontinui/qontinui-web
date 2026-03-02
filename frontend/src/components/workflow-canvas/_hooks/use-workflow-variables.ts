import { useState, useCallback } from "react";

export function useWorkflowVariables() {
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [newVarScope, setNewVarScope] = useState<
    "local" | "process" | "global"
  >("local");

  const updateVariable = useCallback(
    (scope: string, name: string, value: unknown) => {
      console.log("Update variable:", scope, name, value);
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
    console.log("Remove variable:", scope, name);
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
