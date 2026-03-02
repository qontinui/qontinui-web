import { useEffect, useCallback } from "react";
import type { SearchResultItem } from "@/services/global-search-service";

interface UseKeyboardNavigationArgs {
  results: SearchResultItem[];
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  onSelect: (result: SearchResultItem) => void;
  onClose: () => void;
  resultRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}

export function useKeyboardNavigation({
  results,
  selectedIndex,
  setSelectedIndex,
  onSelect,
  onClose,
  resultRefs,
}: UseKeyboardNavigationArgs) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev: number) =>
          Math.min(prev + 1, results.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev: number) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        onSelect(results[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [results, selectedIndex, setSelectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    if (resultRefs.current[selectedIndex]) {
      resultRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex, resultRefs]);

  return { handleKeyDown };
}
