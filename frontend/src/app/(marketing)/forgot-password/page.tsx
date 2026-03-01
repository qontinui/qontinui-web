"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(
        "http://localhost:8000/api/v1/auth/password-reset",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Request failed");
      }

      setSubmitted(true);
      toast.success("Password reset email sent", {
        description:
          "Check your email for instructions to reset your password.",
      });
    } catch (_error) {
      toast.error("Failed to send reset email", {
        description: "Please try again or contact support.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-2">Forgot Password?</h2>
            <p className="text-muted-foreground">
              Enter your email and we&apos;ll send you instructions to reset
              your password.
            </p>
          </div>

          {submitted ? (
            <div className="text-center space-y-4">
              <div className="p-4 bg-accent/10 rounded-lg">
                <p className="text-sm">
                  If an account exists with <strong>{email}</strong>, you will
                  receive a password reset email shortly.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push("/login")}
                className="w-full"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send Reset Email"}
              </Button>

              <div className="text-center">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.push("/")}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  <ArrowLeft className="inline mr-1 h-3 w-3" />
                  Back to Login
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
