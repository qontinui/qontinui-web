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

  const handleSuccess = (user: User) => {
    onOpenChange(false);
    // Redirect to admin page if superuser, otherwise dashboard.
    // Dashboard handles further product-mode routing.
    if (user?.is_superuser) {
      router.push("/admin");
    } else {
      router.push("/dashboard");
    }
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
