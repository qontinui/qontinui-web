"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthForm } from "@/components/auth-form";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  // Sign-in is a full-page redirect to the Cognito hosted UI, so there is no
  // in-dialog success callback — the `/auth/callback` route establishes the
  // session and lands the user on the post-login home after the round-trip.
  //
  // No `next` is passed on purpose: the destination is owned solely by
  // `/auth/callback` (the Coord Console). Passing one here previously routed
  // through the `/dashboard` shim and landed users on `/build/workflows` — a
  // hidden, advanced-only authoring surface, not the product's home.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            Sign in to save and manage your automation projects
          </DialogDescription>
        </DialogHeader>

        <AuthForm />
      </DialogContent>
    </Dialog>
  );
}
