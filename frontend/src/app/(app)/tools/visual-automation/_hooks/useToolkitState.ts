import { useState } from "react";

export function useToolkitState() {
  const [showToolkit, setShowToolkit] = useState(false);
  const [toolkitTab, setToolkitTab] = useState<"actions" | "macros">("actions");
  const [clickType, setClickType] = useState("click");
  const [typeText, setTypeText] = useState("");
  const [hotkeyInput, setHotkeyInput] = useState("");

  const toggleToolkit = () => setShowToolkit((prev) => !prev);

  return {
    showToolkit,
    toggleToolkit,
    toolkitTab,
    setToolkitTab,
    clickType,
    setClickType,
    typeText,
    setTypeText,
    hotkeyInput,
    setHotkeyInput,
  };
}
