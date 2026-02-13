import { useState, useCallback } from "react";

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
    console.log("Exporting project...");
  }, []);

  const handleImportProject = useCallback(() => {
    console.log("Importing project...");
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
