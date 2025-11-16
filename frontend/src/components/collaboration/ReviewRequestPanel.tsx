'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  GitPullRequest,
  Check,
  X,
  MessageSquare,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Send,
  Loader2,
  User,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const reviewRequestSchema = z.object({
  reviewer_ids: z.array(z.string()).min(1, 'Select at least one reviewer'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
});

type ReviewRequestFormData = z.infer<typeof reviewRequestSchema>;

const reviewCommentSchema = z.object({
  comment: z.string().min(1, 'Comment cannot be empty'),
  decision: z.enum(['approve', 'request_changes', 'comment']),
});

type ReviewCommentFormData = z.infer<typeof reviewCommentSchema>;

export type ReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected';

export interface Reviewer {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
}

export interface ReviewComment {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  reviewer_avatar?: string;
  comment: string;
  decision: 'approve' | 'request_changes' | 'reject' | 'comment';
  created_at: Date | string;
}

export interface ReviewRequest {
  id: string;
  resource_id: string;
  resource_type: string;
  resource_name: string;
  requester_id: string;
  requester_name: string;
  requester_avatar?: string;
  description: string;
  status: ReviewStatus;
  reviewers: Reviewer[];
  comments: ReviewComment[];
  created_at: Date | string;
  updated_at?: Date | string;
}

interface ReviewRequestPanelProps {
  reviewRequest?: ReviewRequest;
  availableReviewers: Reviewer[];
  currentUserId: string;
  isRequester?: boolean;
  isReviewer?: boolean;
  onCreateReview: (data: ReviewRequestFormData) => Promise<void>;
  onSubmitReview: (data: ReviewCommentFormData) => Promise<void>;
  onCancelReview?: () => Promise<void>;
  className?: string;
}

const statusIcons = {
  pending: Clock,
  approved: CheckCircle,
  changes_requested: AlertCircle,
  rejected: XCircle,
};

const statusColors = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-500 border-green-500/20',
  changes_requested: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  rejected: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const decisionIcons = {
  approve: CheckCircle,
  request_changes: AlertCircle,
  reject: XCircle,
  comment: MessageSquare,
};

const decisionColors = {
  approve: 'text-green-500',
  request_changes: 'text-orange-500',
  reject: 'text-red-500',
  comment: 'text-blue-500',
};

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
  const [loading, setLoading] = React.useState(false);
  const [selectedReviewers, setSelectedReviewers] = React.useState<string[]>([]);

  const createForm = useForm<ReviewRequestFormData>({
    resolver: zodResolver(reviewRequestSchema),
    defaultValues: {
      reviewer_ids: [],
      description: '',
    },
  });

  const reviewForm = useForm<ReviewCommentFormData>({
    resolver: zodResolver(reviewCommentSchema),
    defaultValues: {
      comment: '',
      decision: 'comment',
    },
  });

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  };

  const handleCreateReview = async (data: ReviewRequestFormData) => {
    setLoading(true);
    try {
      await onCreateReview(data);
      toast.success('Review request created');
      createForm.reset();
      setSelectedReviewers([]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create review request');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReview = async (data: ReviewCommentFormData) => {
    setLoading(true);
    try {
      await onSubmitReview(data);
      toast.success('Review submitted');
      reviewForm.reset();
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit review');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReview = async () => {
    if (!confirm('Cancel this review request?')) return;
    if (!onCancelReview) return;

    setLoading(true);
    try {
      await onCancelReview();
      toast.success('Review request cancelled');
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel review');
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
      'reviewer_ids',
      selectedReviewers.includes(reviewerId)
        ? selectedReviewers.filter((id) => id !== reviewerId)
        : [...selectedReviewers, reviewerId]
    );
  };

  // Show create form if no review request exists
  if (!reviewRequest) {
    return (
      <Card className={cn(className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            Request Review
          </CardTitle>
          <CardDescription>
            Request feedback from team members before finalizing changes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={createForm.handleSubmit(handleCreateReview)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Select Reviewers</Label>
              <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto p-2 border rounded-lg">
                {availableReviewers.map((reviewer) => (
                  <div
                    key={reviewer.id}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                      selectedReviewers.includes(reviewer.id)
                        ? 'bg-primary/10 border border-primary'
                        : 'hover:bg-muted border border-transparent'
                    )}
                    onClick={() => toggleReviewer(reviewer.id)}
                  >
                    <Avatar
                      src={reviewer.avatar_url}
                      fallback={
                        <span className="text-xs font-medium">
                          {getInitials(reviewer.name)}
                        </span>
                      }
                      className="h-8 w-8"
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium">{reviewer.name}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {reviewer.email}
                      </span>
                    </div>
                    {selectedReviewers.includes(reviewer.id) && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </div>
                ))}
              </div>
              {createForm.formState.errors.reviewer_ids && (
                <p className="text-sm text-destructive">
                  {createForm.formState.errors.reviewer_ids.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what needs to be reviewed..."
                {...createForm.register('description')}
                disabled={loading}
                className="min-h-[100px]"
              />
              {createForm.formState.errors.description && (
                <p className="text-sm text-destructive">
                  {createForm.formState.errors.description.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Request...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit for Review
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  // Show review request details
  const StatusIcon = statusIcons[reviewRequest.status];
  const userReview = reviewRequest.comments.find(
    (c) => c.reviewer_id === currentUserId
  );
  const hasUserReviewed = !!userReview;

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            Review Request
          </CardTitle>
          <Badge variant="outline" className={statusColors[reviewRequest.status]}>
            <StatusIcon className="mr-1 h-3 w-3" />
            {reviewRequest.status.replace('_', ' ')}
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
            {reviewRequest.requester_name} requested review{' '}
            {formatDate(reviewRequest.created_at)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Description */}
        <div>
          <Label className="text-xs text-muted-foreground">Description</Label>
          <p className="text-sm mt-1 whitespace-pre-wrap">
            {reviewRequest.description}
          </p>
        </div>

        <Separator />

        {/* Reviewers */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            Reviewers ({reviewRequest.reviewers.length})
          </Label>
          <div className="space-y-2">
            {reviewRequest.reviewers.map((reviewer) => {
              const review = reviewRequest.comments.find(
                (c) => c.reviewer_id === reviewer.id
              );
              const DecisionIcon = review
                ? decisionIcons[review.decision]
                : Clock;

              return (
                <div
                  key={reviewer.id}
                  className="flex items-center gap-3 p-2 rounded-lg border"
                >
                  <Avatar
                    src={reviewer.avatar_url}
                    fallback={
                      <span className="text-xs font-medium">
                        {getInitials(reviewer.name)}
                      </span>
                    }
                    className="h-8 w-8"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium">{reviewer.name}</span>
                    {review && (
                      <span className="text-xs text-muted-foreground">
                        {review.decision.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <DecisionIcon
                    className={cn(
                      'h-4 w-4',
                      review
                        ? decisionColors[review.decision]
                        : 'text-muted-foreground'
                    )}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Comments */}
        {reviewRequest.comments.length > 0 && (
          <>
            <Separator />
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Reviews ({reviewRequest.comments.length})
              </Label>
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-3">
                  {reviewRequest.comments.map((comment) => {
                    const DecisionIcon = decisionIcons[comment.decision];
                    return (
                      <div key={comment.id} className="flex gap-3 p-3 border rounded-lg">
                        <Avatar
                          src={comment.reviewer_avatar}
                          fallback={
                            <span className="text-xs font-medium">
                              {getInitials(comment.reviewer_name)}
                            </span>
                          }
                          className="h-8 w-8 mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">
                              {comment.reviewer_name}
                            </span>
                            <DecisionIcon
                              className={cn('h-3 w-3', decisionColors[comment.decision])}
                            />
                            <span
                              className={cn(
                                'text-xs',
                                decisionColors[comment.decision]
                              )}
                            >
                              {comment.decision.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {formatDate(comment.created_at)}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {comment.comment}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </>
        )}

        <Separator />

        {/* Actions */}
        {isReviewer && !hasUserReviewed && reviewRequest.status === 'pending' && (
          <form
            onSubmit={reviewForm.handleSubmit(handleSubmitReview)}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="comment">Your Review</Label>
              <Textarea
                id="comment"
                placeholder="Add your feedback..."
                {...reviewForm.register('comment')}
                disabled={loading}
                className="min-h-[100px]"
              />
              {reviewForm.formState.errors.comment && (
                <p className="text-sm text-destructive">
                  {reviewForm.formState.errors.comment.message}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="submit"
                variant="outline"
                className="flex-1 border-green-500/30 hover:bg-green-500/10 text-green-500"
                onClick={() => reviewForm.setValue('decision', 'approve')}
                disabled={loading}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve
              </Button>
              <Button
                type="submit"
                variant="outline"
                className="flex-1 border-orange-500/30 hover:bg-orange-500/10 text-orange-500"
                onClick={() => reviewForm.setValue('decision', 'request_changes')}
                disabled={loading}
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                Request Changes
              </Button>
            </div>
          </form>
        )}

        {isRequester && onCancelReview && reviewRequest.status === 'pending' && (
          <Button
            variant="outline"
            className="w-full border-red-500/30 hover:bg-red-500/10 text-red-500"
            onClick={handleCancelReview}
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
