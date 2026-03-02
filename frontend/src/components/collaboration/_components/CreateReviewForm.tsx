"use client";

import { Check, Send, Loader2, GitPullRequest } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type Reviewer,
  type ReviewRequestFormData,
  getInitials,
} from "../_types/review";

interface CreateReviewFormProps {
  availableReviewers: Reviewer[];
  selectedReviewers: string[];
  createForm: UseFormReturn<ReviewRequestFormData>;
  loading: boolean;
  onSubmit: (data: ReviewRequestFormData) => Promise<void>;
  onToggleReviewer: (reviewerId: string) => void;
  className?: string;
}

export function CreateReviewForm({
  availableReviewers,
  selectedReviewers,
  createForm,
  loading,
  onSubmit,
  onToggleReviewer,
  className,
}: CreateReviewFormProps) {
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
          onSubmit={createForm.handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Select Reviewers</Label>
            <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto p-2 border rounded-lg">
              {availableReviewers.map((reviewer) => (
                <div
                  key={reviewer.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                    selectedReviewers.includes(reviewer.id)
                      ? "bg-primary/10 border border-primary"
                      : "hover:bg-muted border border-transparent"
                  )}
                  onClick={() => onToggleReviewer(reviewer.id)}
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
              {...createForm.register("description")}
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
