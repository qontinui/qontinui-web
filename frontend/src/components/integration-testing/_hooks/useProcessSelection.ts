import { useState, useMemo } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { createLogger } from "@/lib/logger";

const log = createLogger("useProcessSelection");

export function useProcessSelection(
  onProcessChange?: (processId: string) => void
) {
  const { workflows = [], categories = [] } = useAutomation();
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");

  const processes = useMemo(() => {
    log.debug("workflows from context:", workflows?.length);
    return workflows;
  }, [workflows]);

  const processesByCategory = useMemo(() => {
    const grouped = new Map<string, typeof processes>();
    const categoryNames = categories?.map((c) => c.name) || [];

    if (categoryNames.length > 0) {
      categoryNames.forEach((categoryName) => {
        const categoryProcesses = processes.filter(
          (p) => p.category === categoryName
        );
        if (categoryProcesses.length > 0) {
          grouped.set(categoryName, categoryProcesses);
        }
      });
    }

    const uncategorized = processes.filter(
      (p) =>
        !p.category ||
        categoryNames.length === 0 ||
        !categoryNames.includes(p.category)
    );
    if (uncategorized.length > 0) {
      grouped.set("Uncategorized", uncategorized);
    }

    return grouped;
  }, [processes, categories]);

  const categoryProcesses = useMemo(() => {
    const result = !selectedCategory
      ? processes
      : processesByCategory.get(selectedCategory) || [];
    log.debug("categoryProcesses:", {
      selectedCategory,
      resultCount: result?.length,
    });
    return result;
  }, [selectedCategory, processesByCategory, processes]);

  const selectedProcess = useMemo(
    () => processes.find((p) => p.id === selectedProcessId),
    [processes, selectedProcessId]
  );

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value === "all" ? "" : value);
    setSelectedProcessId("");
  };

  const handleProcessChange = (value: string) => {
    setSelectedProcessId(value);
    onProcessChange?.(value);
  };

  return {
    selectedCategory,
    selectedProcessId,
    processes,
    processesByCategory,
    categoryProcesses,
    selectedProcess,
    handleCategoryChange,
    handleProcessChange,
  };
}
