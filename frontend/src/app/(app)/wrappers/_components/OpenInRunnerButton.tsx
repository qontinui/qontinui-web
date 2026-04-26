"use client";

import React from "react";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OpenInRunnerButtonProps {
  wrapperId: string;
  className?: string;
}

/**
 * Renders the "Open in runner" deep-link plus a fallback download CTA.
 *
 * The custom `qontinui-runner://` protocol is registered by the Tauri app —
 * see Phase 6.3 of the integration plan. Browsers without the handler will
 * silently no-op the click; the fallback link below covers that case.
 */
export function OpenInRunnerButton({
  wrapperId,
  className,
}: OpenInRunnerButtonProps) {
  const deepLink = `qontinui-runner://wrappers/install/${encodeURIComponent(
    wrapperId
  )}`;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        asChild
        size="lg"
        className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white"
      >
        <a href={deepLink}>
          <Download className="w-4 h-4 mr-2" />
          Open in runner
        </a>
      </Button>
      <p className="text-xs text-muted-foreground">
        Don&apos;t have the runner yet?{" "}
        <Link
          href="/download"
          className="inline-flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline"
        >
          Download it
          <ExternalLink className="w-3 h-3" />
        </Link>
      </p>
    </div>
  );
}
