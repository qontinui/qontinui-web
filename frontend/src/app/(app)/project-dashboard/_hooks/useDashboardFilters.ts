import { useState, useCallback } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("DashboardFilters");

export interface DashboardFiltersResult {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
  handleExportProject: () => void;
  handleImportProject: () => void;
}

export function useDashboardFilters(): DashboardFiltersResult {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState("overview");

  const handleExportProject = useCallback(() => {
    log.debug("Exporting project...");
  }, []);

  const handleImportProject = useCallback(() => {
    log.debug("Importing project...");
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    selectedTab,
    setSelectedTab,
    handleExportProject,
    handleImportProject,
  };
}
