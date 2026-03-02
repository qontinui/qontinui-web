import { useState, useMemo } from "react";
import type { FindingView, FindingsSummaryView } from "@/lib/task-run-mappers";

export function useFindingsFilters(data: FindingsSummaryView | null) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const categories = useMemo(() => {
    if (!data?.by_category) return [];
    return Object.keys(data.by_category).sort();
  }, [data]);

  const filteredFindings = useMemo(() => {
    if (!data?.recent) return [];
    return data.recent.filter((finding: FindingView) => {
      const matchesSeverity =
        severityFilter === "all" ||
        finding.severity.toLowerCase() === severityFilter;
      const matchesCategory =
        categoryFilter === "all" || finding.category === categoryFilter;
      const matchesStatus =
        statusFilter === "all" || finding.status.toLowerCase() === statusFilter;
      return matchesSeverity && matchesCategory && matchesStatus;
    });
  }, [data, severityFilter, categoryFilter, statusFilter]);

  return {
    severityFilter,
    setSeverityFilter,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    categories,
    filteredFindings,
  };
}
