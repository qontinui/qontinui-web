"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Removed unused Select components - using native select instead
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Copy, Download, Plus } from "lucide-react";
import { useCreateRunnerToken } from "@/hooks/useRunners";
import type { RunnerTokenWithSecret } from "@/types/runner";
import { toast } from "sonner";

const formSchema = z.object({
  name: z.string().min(1, "Token name is required").max(100, "Name too long"),
  expiresInDays: z.string(),
});

type FormData = z.infer<typeof formSchema>;

interface CreateTokenDialogProps {
  children?: React.ReactNode;
  onSuccess?: (token: RunnerTokenWithSecret) => void;
}

export function CreateTokenDialog({
  children,
  onSuccess,
}: CreateTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [createdToken, setCreatedToken] =
    useState<RunnerTokenWithSecret | null>(null);
  const createMutation = useCreateRunnerToken();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      expiresInDays: "30",
    },
  });

  const expiresInDays = watch("expiresInDays");

  const onSubmit = async (data: FormData) => {
    const expiryDays =
      data.expiresInDays === "never" ? null : parseInt(data.expiresInDays, 10);

    try {
      const token = await createMutation.mutateAsync({
        name: data.name,
        expiresInDays: expiryDays,
      });

      setCreatedToken(token);
      onSuccess?.(token);
    } catch (error) {
      console.error("Failed to create token:", error);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => {
      setCreatedToken(null);
      reset();
    }, 300);
  };

  const handleCopyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      toast.success("Token copied to clipboard!");
    } catch (error) {
      toast.error("Failed to copy token");
    }
  };

  const handleDownloadToken = () => {
    if (!createdToken) return;
    const blob = new Blob([createdToken.token], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${createdToken.name}-token.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Token downloaded!");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black">
            <Plus className="w-4 h-4 mr-2" />
            Create New Token
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-[#1A1A1B] border-gray-800 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {createdToken
              ? "Token Created Successfully"
              : "Create Runner Token"}
          </DialogTitle>
          <DialogDescription>
            {createdToken
              ? "Save this token securely. It will only be shown once."
              : "Create a new token for connecting a desktop runner to your account."}
          </DialogDescription>
        </DialogHeader>

        {!createdToken ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Warning Alert */}
            <Alert className="bg-amber-500/10 border-amber-500/50">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-amber-200">
                The token will only be shown once after creation. Make sure to
                save it securely.
              </AlertDescription>
            </Alert>

            {/* Token Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Token Name</Label>
              <Input
                id="name"
                placeholder="e.g., My Laptop, Work Desktop"
                {...register("name")}
                className="bg-[#0A0A0B] border-gray-700"
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name.message}</p>
              )}
              <p className="text-sm text-gray-400">
                Give this token a memorable name to identify the runner
              </p>
            </div>

            {/* Expiration */}
            <div className="space-y-2">
              <Label htmlFor="expiration">Expiration</Label>
              <select
                value={expiresInDays}
                onChange={(e) => setValue("expiresInDays", e.target.value)}
                className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#00D9FF]"
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
                <option value="never">Never expires</option>
              </select>
              <p className="text-sm text-gray-400">
                Choose when this token should expire. You can revoke it anytime.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="border-gray-700"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
              >
                {createMutation.isPending ? "Creating..." : "Create Token"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Success Alert */}
            <Alert className="bg-green-500/10 border-green-500/50">
              <AlertDescription className="text-green-200">
                Token created successfully! Make sure to copy it now - it won't
                be shown again.
              </AlertDescription>
            </Alert>

            {/* Token Display */}
            <div className="space-y-2">
              <Label>Token</Label>
              <div className="relative">
                <Input
                  value={createdToken.token}
                  readOnly
                  className="bg-[#0A0A0B] border-gray-700 font-mono text-sm pr-10"
                  onClick={(e) => e.currentTarget.select()}
                />
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  onClick={handleCopyToken}
                  className="flex-1 bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Token
                </Button>
                <Button
                  onClick={handleDownloadToken}
                  variant="outline"
                  className="border-gray-700"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>

            {/* Token Details */}
            <div className="bg-[#0A0A0B] border border-gray-700 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Name:</span>
                <span className="text-white font-medium">
                  {createdToken.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Expires:</span>
                <span className="text-white">
                  {createdToken.expires_at
                    ? new Date(createdToken.expires_at).toLocaleDateString()
                    : "Never"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Created:</span>
                <span className="text-white">
                  {new Date(createdToken.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Close Button */}
            <div className="flex justify-end">
              <Button
                onClick={handleClose}
                className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
