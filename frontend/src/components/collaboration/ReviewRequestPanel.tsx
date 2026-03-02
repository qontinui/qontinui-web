"use client";

export type {
  ReviewStatus,
  Reviewer,
  ReviewComment,
  ReviewRequest,
} from "./_types/review";

import { useReviewActions } from "./_hooks/useReviewActions";
import { CreateReviewForm } from "./_components/CreateReviewForm";
import { ReviewDetails } from "./_components/ReviewDetails";
import type { ReviewRequestPanelProps } from "./_types/review";

export function ReviewRequestPanel({
  reviewRequest,
  availableReviewers,
  currentUserId,
  isRequester = false,
  isReviewer = false,
  onCreateReview,
  onSubmitReview,
  onCancelReview,
  className,
}: ReviewRequestPanelProps) {
  const {
    loading,
    selectedReviewers,
    createForm,
    reviewForm,
    handleCreateReview,
    handleSubmitReview,
    handleCancelReview,
    toggleReviewer,
  } = useReviewActions({ onCreateReview, onSubmitReview, onCancelReview });

  if (!reviewRequest) {
    return (
      <CreateReviewForm
        availableReviewers={availableReviewers}
        selectedReviewers={selectedReviewers}
        createForm={createForm}
        loading={loading}
        onSubmit={handleCreateReview}
        onToggleReviewer={toggleReviewer}
        className={className}
      />
    );
  }

  return (
    <ReviewDetails
      reviewRequest={reviewRequest}
      currentUserId={currentUserId}
      isRequester={isRequester}
      isReviewer={isReviewer}
      loading={loading}
      reviewForm={reviewForm}
      onSubmitReview={handleSubmitReview}
      onCancelReview={onCancelReview ? handleCancelReview : undefined}
      className={className}
    />
  );
}
