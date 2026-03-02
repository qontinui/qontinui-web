"use client";

import { CheckCircle, AlertCircle } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { type ReviewCommentFormData } from "../_types/review";

interface ReviewActionFormProps {
  reviewForm: UseFormReturn<ReviewCommentFormData>;
  loading: boolean;
  onSubmit: (data: ReviewCommentFormData) => Promise<void>;
}

export function ReviewActionForm({
  reviewForm,
  loading,
  onSubmit,
}: ReviewActionFormProps) {
  return (
    <form onSubmit={reviewForm.handleSubmit(onSubmit)} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="comment">Your Review</Label>
        <Textarea
          id="comment"
          placeholder="Add your feedback..."
          {...reviewForm.register("comment")}
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
          onClick={() => reviewForm.setValue("decision", "approve")}
          disabled={loading}
        >
          <CheckCircle className="mr-2 h-4 w-4" />
          Approve
        </Button>
        <Button
          type="submit"
          variant="outline"
          className="flex-1 border-orange-500/30 hover:bg-orange-500/10 text-orange-500"
          onClick={() => reviewForm.setValue("decision", "request_changes")}
          disabled={loading}
        >
          <AlertCircle className="mr-2 h-4 w-4" />
          Request Changes
        </Button>
      </div>
    </form>
  );
}
