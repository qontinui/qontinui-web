"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const {
    mutate: verifyEmail,
    status: mutationStatus,
    error: mutationError,
  } = useMutation({
    mutationFn: async (verifyToken: string) => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const response = await fetch(`${apiUrl}/api/v1/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: verifyToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Verification failed. The link may be invalid or expired."
        );
      }

      return data;
    },
    onSuccess: () => {
      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push("/");
      }, 3000);
    },
  });

  useEffect(() => {
    if (token) {
      verifyEmail(token);
    }
  }, [token, verifyEmail]);

  // Derive status and message from mutation state
  const status: "verifying" | "success" | "error" = !token
    ? "error"
    : mutationStatus === "success"
      ? "success"
      : mutationStatus === "error"
        ? "error"
        : "verifying";

  const message = !token
    ? "Invalid verification link. Please check your email and try again."
    : mutationStatus === "success"
      ? "Your email has been verified successfully!"
      : mutationStatus === "error"
        ? mutationError instanceof Error
          ? mutationError.message
          : "Failed to verify email. Please try again later."
        : "";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="p-8">
          <div className="text-center space-y-6">
            {status === "verifying" && (
              <>
                <div className="flex justify-center">
                  <Loader2 className="h-16 w-16 text-primary animate-spin" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">
                    Verifying Your Email
                  </h2>
                  <p className="text-muted-foreground">
                    Please wait while we verify your email address...
                  </p>
                </div>
              </>
            )}

            {status === "success" && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-green-100 dark:bg-green-900/20 p-4">
                    <CheckCircle2 className="h-16 w-16 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Email Verified!</h2>
                  <p className="text-muted-foreground mb-4">{message}</p>
                  <p className="text-sm text-muted-foreground">
                    Redirecting to home page...
                  </p>
                </div>
                <Button onClick={() => router.push("/")} className="w-full">
                  Go to Home
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4">
                    <XCircle className="h-16 w-16 text-red-600 dark:text-red-400" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">
                    Verification Failed
                  </h2>
                  <p className="text-muted-foreground mb-4">{message}</p>
                </div>
                <div className="space-y-2">
                  <Button onClick={() => router.push("/")} className="w-full">
                    Go to Home
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push("/forgot-password")}
                    className="w-full"
                  >
                    Request New Link
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

        <div className="mt-4 text-center">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-primary"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmail() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
