"use client";

import { Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface ShareLinkSectionProps {
  generatedLink?: string;
  linkCopied: boolean;
  loading: boolean;
  onCopyLink: () => void;
}

export function ShareLinkSection({
  generatedLink,
  linkCopied,
  loading,
  onCopyLink,
}: ShareLinkSectionProps) {
  return (
    <>
      <Separator />
      <div className="space-y-2">
        <Label>Share Link</Label>
        <div className="flex gap-2">
          <Input
            value={generatedLink || "Generate a shareable link"}
            readOnly
            className="flex-1 font-mono text-sm"
          />
          <Button
            onClick={onCopyLink}
            disabled={loading}
            variant={linkCopied ? "default" : "outline"}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : linkCopied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          Anyone with this link can view the project
        </p>
      </div>
    </>
  );
}
