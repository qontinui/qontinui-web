/**
 * Template Rating Dialog Component
 *
 * Dialog for rating and reviewing a community template.
 * Allows users to:
 * - Select a 1-5 star rating
 * - Write an optional review
 * - Submit or update their rating
 */

import { useState } from "react";
import { workflowTemplates } from "@/services/workflow-templates";
import { isValidRating } from "@/types/workflow-templates";

// ============================================================================
// Types
// ============================================================================

export interface TemplateRatingDialogProps {
  templateId: number;
  templateName: string;
  existingRating?: number;
  existingReview?: string;
  onClose: () => void;
  onRated?: (rating: number, review?: string) => void;
}

// ============================================================================
// Star Rating Component
// ============================================================================

interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  disabled?: boolean;
}

function StarRating({ rating, onRatingChange, disabled }: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const displayRating = hoverRating !== null ? hoverRating : rating;

  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`star-button ${displayRating >= star ? "filled" : "empty"}`}
          onClick={() => !disabled && onRatingChange(star)}
          onMouseEnter={() => !disabled && setHoverRating(star)}
          onMouseLeave={() => setHoverRating(null)}
          disabled={disabled}
          aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <span className="star-icon">{displayRating >= star ? "★" : "☆"}</span>
        </button>
      ))}
      <span className="rating-text">
        {rating > 0 ? `${rating} out of 5` : "Select a rating"}
      </span>
    </div>
  );
}

// ============================================================================
// Template Rating Dialog Component
// ============================================================================

export function TemplateRatingDialog({
  templateId,
  templateName,
  existingRating,
  existingReview,
  onClose,
  onRated,
}: TemplateRatingDialogProps) {
  const [rating, setRating] = useState(existingRating || 0);
  const [reviewText, setReviewText] = useState(existingReview || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUpdate = existingRating !== undefined && existingRating > 0;

  const handleSubmit = async () => {
    if (!isValidRating(rating)) {
      setError("Please select a rating between 1 and 5 stars");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await workflowTemplates.rateCommunityTemplate(
        templateId,
        rating,
        reviewText || undefined
      );

      if (onRated) {
        onRated(rating, reviewText || undefined);
      }
      onClose();
    } catch (err) {
      console.error("Failed to submit rating:", err);
      setError(err instanceof Error ? err.message : "Failed to submit rating");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isUpdate) return;

    setLoading(true);
    setError(null);

    try {
      await workflowTemplates.deleteTemplateRating(templateId);
      onClose();
    } catch (err) {
      console.error("Failed to delete rating:", err);
      setError(err instanceof Error ? err.message : "Failed to delete rating");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rating-dialog-overlay">
      <div className="rating-dialog">
        <div className="dialog-header">
          <h2>{isUpdate ? "Update Your Rating" : "Rate This Template"}</h2>
          <button
            className="close-button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="dialog-content">
          <p className="template-name">
            Rating: <strong>{templateName}</strong>
          </p>

          {error && <div className="error-message">{error}</div>}

          <div className="rating-section">
            <p>Your Rating *</p>
            <StarRating
              rating={rating}
              onRatingChange={setRating}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="review-text">Your Review (optional)</label>
            <textarea
              id="review-text"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Share your experience with this template..."
              rows={4}
              maxLength={2000}
              disabled={loading}
            />
            <span className="char-count">{reviewText.length}/2000</span>
          </div>

          <div className="rating-guidelines">
            <h4>Rating Guidelines</h4>
            <ul>
              <li>
                <strong>5 stars:</strong> Excellent - Works perfectly, well
                documented
              </li>
              <li>
                <strong>4 stars:</strong> Good - Minor issues or improvements
                possible
              </li>
              <li>
                <strong>3 stars:</strong> Average - Functional but needs work
              </li>
              <li>
                <strong>2 stars:</strong> Poor - Significant issues
              </li>
              <li>
                <strong>1 star:</strong> Broken - Doesn&apos;t work as described
              </li>
            </ul>
          </div>
        </div>

        <div className="dialog-footer">
          <button
            className="cancel-button"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>

          {isUpdate && (
            <button
              className="delete-button"
              onClick={handleDelete}
              disabled={loading}
            >
              Delete Rating
            </button>
          )}

          <button
            className="primary-button"
            onClick={handleSubmit}
            disabled={loading || rating === 0}
          >
            {loading
              ? "Submitting..."
              : isUpdate
                ? "Update Rating"
                : "Submit Rating"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TemplateRatingDialog;
