import * as React from "react";
import { toast } from "sonner";

interface UseShareLinkOptions {
  initialLink?: string;
  onGenerateLink?: () => Promise<string>;
}

export function useShareLink({
  initialLink,
  onGenerateLink,
}: UseShareLinkOptions) {
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [generatedLink, setGeneratedLink] = React.useState(initialLink);
  const [loading, setLoading] = React.useState(false);

  const handleCopyLink = async () => {
    if (!onGenerateLink) {
      toast.error("Link generation not available");
      return;
    }

    if (!generatedLink) {
      setLoading(true);
      try {
        const link = await onGenerateLink();
        setGeneratedLink(link);
        await navigator.clipboard.writeText(link);
        setLinkCopied(true);
        toast.success("Link copied to clipboard");
        setTimeout(() => setLinkCopied(false), 2000);
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : "Failed to generate link"
        );
      } finally {
        setLoading(false);
      }
    } else {
      await navigator.clipboard.writeText(generatedLink);
      setLinkCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  return {
    linkCopied,
    generatedLink,
    linkLoading: loading,
    handleCopyLink,
  };
}
