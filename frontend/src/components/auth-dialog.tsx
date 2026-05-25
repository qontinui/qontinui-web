"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthForm } from "@/components/auth-form";
import type { User } from "@/types/auth-types";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "signin" | "signup";
}

export function AuthDialog({
  open,
  onOpenChange,
  defaultTab = "signin",
}: AuthDialogProps) {
  const router = useRouter();

  const handleSuccess = (_user: User) => {
    onOpenChange(false);
    // Land on the general, mode-aware home. `/dashboard` forwards to
    // `/build/workflows` (AI Dev) or `/tools/visual-automation` (Visual)
    // based on the stored product mode. Superusers are NOT sent to the
    // admin-only hub on login — Admin is an opt-in sidebar destination.
    router.push("/dashboard");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            Sign in to save and manage your automation projects
          </DialogDescription>
        </DialogHeader>

        <AuthForm
          mode={defaultTab}
          onSuccess={handleSuccess}
          onForgotPasswordClick={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
