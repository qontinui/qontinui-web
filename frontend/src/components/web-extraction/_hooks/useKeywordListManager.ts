import { useState, useCallback } from "react";

interface KeywordListManagerOptions {
  currentList: string[];
  onUpdate: (newList: string[]) => void;
  normalize?: (value: string) => string;
}

export function useKeywordListManager({
  currentList,
  onUpdate,
  normalize = (v) => v.trim().toLowerCase(),
}: KeywordListManagerOptions) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = useCallback(() => {
    const normalized = normalize(inputValue);
    if (normalized && !currentList.includes(normalized)) {
      onUpdate([...currentList, normalized]);
      setInputValue("");
    }
  }, [inputValue, currentList, onUpdate, normalize]);

  const handleRemove = useCallback(
    (item: string) => {
      onUpdate(currentList.filter((k) => k !== item));
    },
    [currentList, onUpdate]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleAdd();
    },
    [handleAdd]
  );

  return {
    inputValue,
    setInputValue,
    handleAdd,
    handleRemove,
    handleKeyDown,
    isAddDisabled: !inputValue.trim(),
  };
}
