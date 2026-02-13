import * as React from "react";
import type { TestCase } from "@/services/workflow-testing";

export function useTestCaseTags(testCase?: TestCase) {
  const [tags, setTags] = React.useState<string[]>(testCase?.config.tags || []);
  const [newTag, setNewTag] = React.useState("");

  const addTag = React.useCallback(() => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags((prev) => [...prev, newTag.trim()]);
      setNewTag("");
    }
  }, [newTag, tags]);

  const removeTag = React.useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  return {
    tags,
    setTags,
    newTag,
    setNewTag,
    addTag,
    removeTag,
  };
}
