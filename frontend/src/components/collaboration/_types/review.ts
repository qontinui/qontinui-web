import * as z from "zod";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const reviewRequestSchema = z.object({
  reviewer_ids: z.array(z.string()).min(1, "Select at least one reviewer"),
  description: z.string().min(10, "Description must be at least 10 characters"),
});

export type ReviewRequestFormData = z.infer<typeof reviewRequestSchema>;

export const reviewCommentSchema = z.object({
  comment: z.string().min(1, "Comment cannot be empty"),
  decision: z.enum(["approve", "request_changes", "comment"]),
});

export type ReviewCommentFormData = z.infer<typeof reviewCommentSchema>;

export type ReviewStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected";

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
  decision: "approve" | "request_changes" | "reject" | "comment";
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

export interface ReviewRequestPanelProps {
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

export const statusIcons = {
  pending: Clock,
  approved: CheckCircle,
  changes_requested: AlertCircle,
  rejected: XCircle,
};

export const statusColors = {
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  approved: "bg-green-500/10 text-green-500 border-green-500/20",
  changes_requested: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  rejected: "bg-red-500/10 text-red-500 border-red-500/20",
};

export const decisionIcons = {
  approve: CheckCircle,
  request_changes: AlertCircle,
  reject: XCircle,
  comment: MessageSquare,
};

export const decisionColors = {
  approve: "text-green-500",
  request_changes: "text-orange-500",
  reject: "text-red-500",
  comment: "text-blue-500",
};

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function formatReviewDate(date: Date | string) {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(dateObj, { addSuffix: true });
}
