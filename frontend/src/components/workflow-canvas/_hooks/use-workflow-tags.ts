import { useState, useCallback } from "react";

export function useWorkflowTags() {
  const [newTag, setNewTag] = useState("");

  const addTag = useCallback(() => {
    if (newTag.trim()) {
      console.log("Add tag:", newTag);
      setNewTag("");
    }
  }, [newTag]);

  const removeTag = useCallback((tag: string) => {
    console.log("Remove tag:", tag);
  }, []);

  return {
    newTag,
    setNewTag,
    addTag,
    removeTag,
  };
}
