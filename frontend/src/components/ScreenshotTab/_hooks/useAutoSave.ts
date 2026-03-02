import { useState, useRef } from "react";

export function useAutoSave(triggerSave: () => void) {
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const saveStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleAutoSave = () => {
    triggerSave();
    setSaveStatus("saved");

    if (saveStatusTimeoutRef.current) {
      clearTimeout(saveStatusTimeoutRef.current);
    }

    saveStatusTimeoutRef.current = setTimeout(() => {
      setSaveStatus("idle");
    }, 2000);
  };

  return { saveStatus, handleAutoSave };
}
