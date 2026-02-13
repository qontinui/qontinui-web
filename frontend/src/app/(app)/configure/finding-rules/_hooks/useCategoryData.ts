import { useState, useCallback, useEffect } from "react";
import {
  apiClient,
  type FindingCategoryConfig,
} from "@/lib/api-client";

export function useCategoryData() {
  const [categories, setCategories] = useState<FindingCategoryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchCategories = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getFindingCategories();
      setCategories(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load categories"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const filteredCategories = categories.filter((cat) => {
    if (!searchQuery.trim()) return true;
    const lower = searchQuery.toLowerCase();
    return (
      cat.name.toLowerCase().includes(lower) ||
      cat.slug.toLowerCase().includes(lower) ||
      cat.description.toLowerCase().includes(lower) ||
      cat.default_action_type.toLowerCase().includes(lower)
    );
  });

  return {
    categories,
    setCategories,
    isLoading,
    setIsLoading,
    error,
    setError,
    searchQuery,
    setSearchQuery,
    fetchCategories,
    filteredCategories,
  };
}
