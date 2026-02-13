import { useState } from "react";

export function useCategoryOperations() {
  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset confirmation
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Toggle loading
  const [togglingId, setTogglingId] = useState<string | null>(null);

  return {
    deletingId,
    setDeletingId,
    isDeleting,
    setIsDeleting,
    showResetDialog,
    setShowResetDialog,
    isResetting,
    setIsResetting,
    togglingId,
    setTogglingId,
  };
}
