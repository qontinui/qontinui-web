"use client";

import React, { useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface FeedbackFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FeedbackFormData {
  name: string;
  email: string;
  message: string;
}

export function FeedbackForm({ open, onOpenChange }: FeedbackFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FeedbackFormData>({
    name: "",
    email: "",
    message: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const API_BASE_URL =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const url = `${API_BASE_URL}/api/v1/feedback`;

      console.log("Submitting feedback to:", url);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          page_url:
            typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error("Error response:", errorData);
        throw new Error(
          errorData?.detail || `Failed to submit feedback (${response.status})`
        );
      }

      const result = await response.json();

      toast.success("Feedback Sent!", {
        description: result.message || "Thank you for your feedback!",
      });

      // Reset form and close dialog
      setFormData({ name: "", email: "", message: "" });
      onOpenChange(false);
    } catch (error) {
      console.error("Feedback submission error:", error);
      toast.error("Error", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to submit feedback. Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (field: keyof FeedbackFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isFormValid =
    formData.name.trim().length > 0 &&
    formData.email.trim().length > 0 &&
    formData.message.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Send Feedback
          </DialogTitle>
          <DialogDescription>
            Help us improve Qontinui! Share your thoughts, report issues, or
            suggest new features.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                required
                maxLength={100}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                placeholder="Tell us what you think... (minimum 10 characters)"
                value={formData.message}
                onChange={(e) => handleChange("message", e.target.value)}
                required
                minLength={10}
                maxLength={2000}
                rows={6}
                disabled={isSubmitting}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">
                {formData.message.length}/2000 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isFormValid || isSubmitting}>
              {isSubmitting ? (
                <>Sending...</>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Feedback
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
