import { useState } from "react";

export function useAdvancedSettings() {
  const [selectedMonitor, setSelectedMonitor] = useState("primary");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [initialStates, setInitialStates] = useState("");
  const [autoMinimize, setAutoMinimize] = useState(false);

  const toggleAdvanced = () => setShowAdvanced((prev) => !prev);

  return {
    selectedMonitor,
    setSelectedMonitor,
    showAdvanced,
    toggleAdvanced,
    initialStates,
    setInitialStates,
    autoMinimize,
    setAutoMinimize,
  };
}
