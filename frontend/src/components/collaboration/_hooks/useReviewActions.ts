import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  reviewRequestSchema,
  reviewCommentSchema,
  type ReviewRequestFormData,
  type ReviewCommentFormData,
} from "../_types/review";

interface UseReviewActionsParams {
  onCreateReview: (data: ReviewRequestFormData) => Promise<void>;
  onSubmitReview: (data: ReviewCommentFormData) => Promise<void>;
  onCancelReview?: () => Promise<void>;
}

export function useReviewActions({
  onCreateReview,
  onSubmitReview,
  onCancelReview,
}: UseReviewActionsParams) {
  const [loading, setLoading] = React.useState(false);
  const [selectedReviewers, setSelectedReviewers] = React.useState<string[]>(
    []
  );

  const createForm = useForm<ReviewRequestFormData>({
    resolver: zodResolver(reviewRequestSchema),
    defaultValues: {
      reviewer_ids: [],
      description: "",
    },
  });

  const reviewForm = useForm<ReviewCommentFormData>({
    resolver: zodResolver(reviewCommentSchema),
    defaultValues: {
      comment: "",
      decision: "comment",
    },
  });

  const handleCreateReview = async (data: ReviewRequestFormData) => {
    setLoading(true);
    try {
      await onCreateReview(data);
      toast.success("Review request created");
      createForm.reset();
      setSelectedReviewers([]);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create review request"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReview = async (data: ReviewCommentFormData) => {
    setLoading(true);
    try {
      await onSubmitReview(data);
      toast.success("Review submitted");
      reviewForm.reset();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit review"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReview = async () => {
    if (!confirm("Cancel this review request?")) return;
    if (!onCancelReview) return;

    setLoading(true);
    try {
      await onCancelReview();
      toast.success("Review request cancelled");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to cancel review"
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleReviewer = (reviewerId: string) => {
    setSelectedReviewers((prev) =>
      prev.includes(reviewerId)
        ? prev.filter((id) => id !== reviewerId)
        : [...prev, reviewerId]
    );
    createForm.setValue(
      "reviewer_ids",
      selectedReviewers.includes(reviewerId)
        ? selectedReviewers.filter((id) => id !== reviewerId)
        : [...selectedReviewers, reviewerId]
    );
  };

  return {
    loading,
    selectedReviewers,
    createForm,
    reviewForm,
    handleCreateReview,
    handleSubmitReview,
    handleCancelReview,
    toggleReviewer,
  };
}
