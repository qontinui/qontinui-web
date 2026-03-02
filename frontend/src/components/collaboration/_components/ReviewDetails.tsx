"use client";

import { GitPullRequest, X } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type ReviewRequest,
  type ReviewCommentFormData,
  statusIcons,
  statusColors,
  getInitials,
  formatReviewDate,
} from "../_types/review";
import { ReviewerList } from "./ReviewerList";
import { CommentsList } from "./CommentsList";
import { ReviewActionForm } from "./ReviewActionForm";

interface ReviewDetailsProps {
  reviewRequest: ReviewRequest;
  currentUserId: string;
  isRequester: boolean;
  isReviewer: boolean;
  loading: boolean;
  reviewForm: UseFormReturn<ReviewCommentFormData>;
  onSubmitReview: (data: ReviewCommentFormData) => Promise<void>;
  onCancelReview?: () => Promise<void>;
  className?: string;
}

export function ReviewDetails({
  reviewRequest,
  currentUserId,
  isRequester,
  isReviewer,
  loading,
  reviewForm,
  onSubmitReview,
  onCancelReview,
  className,
}: ReviewDetailsProps) {
  const StatusIcon = statusIcons[reviewRequest.status];
  const hasUserReviewed = reviewRequest.comments.some(
    (c) => c.reviewer_id === currentUserId
  );

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            Review Request
          </CardTitle>
          <Badge
            variant="outline"
            className={statusColors[reviewRequest.status]}
          >
            <StatusIcon className="mr-1 h-3 w-3" />
            {reviewRequest.status.replace("_", " ")}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-2 mt-2">
          <Avatar
            src={reviewRequest.requester_avatar}
            fallback={
              <span className="text-xs font-medium">
                {getInitials(reviewRequest.requester_name)}
              </span>
            }
            className="h-6 w-6"
          />
          <span>
            {reviewRequest.requester_name} requested review{" "}
            {formatReviewDate(reviewRequest.created_at)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Description</Label>
          <p className="text-sm mt-1 whitespace-pre-wrap">
            {reviewRequest.description}
          </p>
        </div>

        <Separator />

        <ReviewerList
          reviewers={reviewRequest.reviewers}
          comments={reviewRequest.comments}
        />

        {reviewRequest.comments.length > 0 && (
          <>
            <Separator />
            <CommentsList comments={reviewRequest.comments} />
          </>
        )}

        <Separator />

        {isReviewer &&
          !hasUserReviewed &&
          reviewRequest.status === "pending" && (
            <ReviewActionForm
              reviewForm={reviewForm}
              loading={loading}
              onSubmit={onSubmitReview}
            />
          )}

        {isRequester &&
          onCancelReview &&
          reviewRequest.status === "pending" && (
            <Button
              variant="outline"
              className="w-full border-red-500/30 hover:bg-red-500/10 text-red-500"
              onClick={onCancelReview}
              disabled={loading}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel Review Request
            </Button>
          )}

        {hasUserReviewed && (
          <div className="text-center text-sm text-muted-foreground">
            You have already submitted your review
          </div>
        )}
      </CardContent>
    </Card>
  );
}
