import { useState, useCallback } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("useWorkflowTags");

export function useWorkflowTags() {
  const [newTag, setNewTag] = useState("");

  const addTag = useCallback(() => {
    if (newTag.trim()) {
      log.debug("Add tag:", newTag);
      setNewTag("");
    }
  }, [newTag]);

  const removeTag = useCallback((tag: string) => {
    log.debug("Remove tag:", tag);
  }, []);

  return {
    newTag,
    setNewTag,
    addTag,
    removeTag,
  };
}
