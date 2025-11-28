"use client";

import React, { useState } from "react";
import { Star, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { PackageRating } from "@/types/code-packages";
import { formatDistanceToNow } from "date-fns";

interface PackageRatingsProps {
  packageId: string;
  ratings: PackageRating[];
  averageRating: number;
  totalRatings: number;
  userRating?: PackageRating;
  onSubmitRating: (rating: number, review?: string) => void;
  isSubmitting?: boolean;
  className?: string;
}

export function PackageRatings({
  packageId,
  ratings,
  averageRating,
  totalRatings,
  userRating,
  onSubmitRating,
  isSubmitting = false,
  className,
}: PackageRatingsProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedRating, setSelectedRating] = useState(userRating?.rating || 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [review, setReview] = useState(userRating?.review || "");

  const handleSubmit = () => {
    if (selectedRating > 0) {
      onSubmitRating(selectedRating, review.trim() || undefined);
      setIsDialogOpen(false);
    }
  };

  const handleStarClick = (rating: number) => {
    setSelectedRating(rating);
  };

  const handleStarHover = (rating: number) => {
    setHoverRating(rating);
  };

  const handleStarLeave = () => {
    setHoverRating(0);
  };

  // Calculate rating distribution
  const ratingDistribution = [5, 4, 3, 2, 1].map((stars) => {
    const count = ratings.filter((r) => r.rating === stars).length;
    const percentage = totalRatings > 0 ? (count / totalRatings) * 100 : 0;
    return { stars, count, percentage };
  });

  return (
    <div className={cn("space-y-6", className)}>
      {/* Overall Rating */}
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
        {/* Average Rating */}
        <div className="flex flex-col items-center justify-center p-6 bg-gray-900/50 rounded-lg border border-gray-800 min-w-[200px]">
          <div className="text-5xl font-bold text-gray-100 mb-2">
            {averageRating.toFixed(1)}
          </div>
          <div className="flex gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={cn(
                  "w-5 h-5",
                  star <= Math.round(averageRating)
                    ? "fill-amber-500 text-amber-500"
                    : "text-gray-600"
                )}
              />
            ))}
          </div>
          <div className="text-sm text-gray-400">
            {totalRatings} {totalRatings === 1 ? "rating" : "ratings"}
          </div>
        </div>

        {/* Rating Distribution */}
        <div className="flex-1 w-full space-y-2">
          {ratingDistribution.map(({ stars, count, percentage }) => (
            <div key={stars} className="flex items-center gap-3">
              <div className="flex items-center gap-1 w-16">
                <span className="text-sm text-gray-400">{stars}</span>
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              </div>
              <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <div className="w-12 text-sm text-gray-400 text-right">
                {count}
              </div>
            </div>
          ))}
        </div>

        {/* Rate Button */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="bg-gray-900/50 border-cyan-500/50 hover:bg-cyan-950/30"
            >
              <Star className="w-4 h-4 mr-2" />
              {userRating ? "Update Rating" : "Rate Package"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Rate this package</DialogTitle>
              <DialogDescription>
                Share your experience with this package to help others make
                informed decisions.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Star Rating */}
              <div className="flex flex-col items-center gap-3">
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => handleStarClick(star)}
                      onMouseEnter={() => handleStarHover(star)}
                      onMouseLeave={handleStarLeave}
                      className="transition-transform hover:scale-110 focus:outline-none"
                    >
                      <Star
                        className={cn(
                          "w-10 h-10 transition-colors",
                          star <= (hoverRating || selectedRating)
                            ? "fill-amber-500 text-amber-500"
                            : "text-gray-600 hover:text-gray-500"
                        )}
                      />
                    </button>
                  ))}
                </div>
                {selectedRating > 0 && (
                  <div className="text-sm text-gray-400">
                    {selectedRating === 1 && "Poor"}
                    {selectedRating === 2 && "Fair"}
                    {selectedRating === 3 && "Good"}
                    {selectedRating === 4 && "Very Good"}
                    {selectedRating === 5 && "Excellent"}
                  </div>
                )}
              </div>

              {/* Review Text */}
              <div className="space-y-2">
                <label
                  htmlFor="review"
                  className="text-sm font-medium text-gray-300"
                >
                  Review (optional)
                </label>
                <Textarea
                  id="review"
                  placeholder="Share your experience with this package..."
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  rows={4}
                  className="resize-none bg-gray-900/50 border-gray-700"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={selectedRating === 0 || isSubmitting}
                className="bg-gradient-to-r from-cyan-500 to-purple-500"
              >
                {isSubmitting ? "Submitting..." : "Submit Rating"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Reviews List */}
      {ratings.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-100">Reviews</h3>
          <div className="space-y-4">
            {ratings.map((rating) => (
              <div
                key={rating.id}
                className="p-4 bg-gray-900/30 rounded-lg border border-gray-800"
              >
                <div className="flex items-start gap-3">
                  <Avatar className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center">
                    <span className="text-white font-semibold">
                      {rating.user.username.charAt(0).toUpperCase()}
                    </span>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-300">
                        {rating.user.username}
                      </span>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={cn(
                              "w-3 h-3",
                              star <= rating.rating
                                ? "fill-amber-500 text-amber-500"
                                : "text-gray-600"
                            )}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(rating.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    {rating.review && (
                      <p className="text-sm text-gray-400 mt-2">
                        {rating.review}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
