"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { useCreateRunnerToken } from "@/hooks/useServerRunners";
import type { CreateRunnerTokenResponse } from "@/types/server-runner";

interface CreateRunnerTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRunnerTokenDialog({
  open,
  onOpenChange,
}: CreateRunnerTokenDialogProps) {
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [created, setCreated] = useState<CreateRunnerTokenResponse | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const createMutation = useCreateRunnerToken();

  const reset = () => {
    setName("");
    setExpiresInDays("");
    setCreated(null);
    setCopied(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        expires_in_days: expiresInDays
          ? Number.parseInt(expiresInDays, 10)
          : null,
      });
      setCreated(result);
    } catch {
      // Error toast is surfaced by the hook.
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.plain_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-surface-raised border-border-subtle sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-primary" />
            {created ? "Save your runner token" : "Create runner token"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "This token will not be shown again. Copy it to the runner's QONTINUI_RUNNER_TOKEN environment variable now."
              : "A long-lived bearer token the runner uses to authenticate against the backend."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle
                className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
                aria-hidden
              />
              <p className="text-amber-200">
                Copy this token now — it will never be shown again. If you lose
                it, revoke it and create a new one.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="runner-token-value">Token</Label>
              <div className="flex gap-2">
                {/*
                  §4.6 — the plaintext bearer token rendered into a readOnly
                  text input (we can't use type="password" because the user
                  needs to be able to see + select-all + copy). Mark it so
                  a UI Bridge snapshot redacts the value.
                */}
                <Input
                  id="runner-token-value"
                  value={created.plain_token}
                  readOnly
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                  data-bridge-redact="true"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopy}
                  aria-label="Copy token to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-text-muted">
                Named <strong>{created.token_record.name}</strong>
                {created.token_record.expires_at
                  ? ` — expires ${new Date(created.token_record.expires_at).toLocaleDateString()}`
                  : " — never expires"}
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => handleOpenChange(false)}
                className="bg-brand-primary hover:bg-brand-primary/80 text-black"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="runner-token-name">Name</Label>
              {/*
                The `id` contains "token" so the rule flags it, but this is
                the user-chosen friendly LABEL for the token (e.g.
                "Production runner - us-east-1"), not the token value.
                Redacting it would hide useful UI Bridge labels with no
                security benefit.
              */}
              {/* eslint-disable-next-line @qontinui-web/no-unredacted-sensitive-input */}
              <Input
                id="runner-token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production runner - us-east-1"
                required
                autoFocus
              />
              <p className="text-xs text-text-muted">
                A label for your records — shown in the token list.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="runner-token-expires">
                Expires in (days, optional)
              </Label>
              {/*
                The `id` contains "token" so the rule flags it, but this is
                a number-of-days expiration value (e.g. "30"), not the
                token itself. Not sensitive.
              */}
              {/* eslint-disable-next-line @qontinui-web/no-unredacted-sensitive-input */}
              <Input
                id="runner-token-expires"
                type="number"
                min={1}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="Leave blank for no expiration"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border-default"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || createMutation.isPending}
                className="bg-brand-primary hover:bg-brand-primary/80 text-black"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create token"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
