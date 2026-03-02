"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import Link from "next/link";
import { getDownloadLabel } from "../_hooks/use-landing-page";

interface DownloadCTASectionProps {
  platform: "windows" | "macos" | "linux" | "unknown";
  handleDownload: () => void;
}

export function DownloadCTASection({
  platform,
  handleDownload,
}: DownloadCTASectionProps) {
  return (
    <section className="py-20 px-4">
      <div className="container mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to Try It?</h2>
        <p className="text-muted-foreground mb-8">
          Download Qontinui Runner and start building AI-assisted development
          workflows today.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button
            size="lg"
            onClick={handleDownload}
            className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
          >
            <Download className="mr-2 h-5 w-5" />
            {getDownloadLabel(platform)}
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          <Link
            href="/runner/download"
            className="text-primary hover:underline"
          >
            All download options
          </Link>{" "}
          | Windows 10+, 64-bit, 200 MB disk space
        </p>
      </div>
    </section>
  );
}
