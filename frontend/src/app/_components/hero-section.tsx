"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Github, Eye, ArrowRight } from "lucide-react";
import { getDownloadLabel } from "../_hooks/use-landing-page";

interface HeroSectionProps {
  platform: "windows" | "macos" | "linux" | "unknown";
  handleDownload: () => void;
}

export function HeroSection({ platform, handleDownload }: HeroSectionProps) {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      <div className="absolute inset-0 dot-grid animate-pulse" />
      <div className="container mx-auto px-4 text-center relative z-10">
        <Badge className="mb-6 bg-green-500/20 text-green-300 border-green-500/30">
          Free & Open Source
        </Badge>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 text-balance">
          AI Development That{" "}
          <span className="text-primary">Verifies Its Own Work</span>
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto text-pretty">
          An open-source desktop app that orchestrates AI coding sessions with
          verification loops, error monitoring, and visual feedback. Bring your
          own AI provider — no vendor lock-in.
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
          <a
            href="https://github.com/qontinui/qontinui-runner"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="lg"
              variant="outline"
              className="text-lg px-8 py-4 border-primary/30 hover:border-primary hover:bg-primary/10"
            >
              <Github className="mr-2 h-5 w-5" />
              View on GitHub
            </Button>
          </a>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Also available: macOS (coming soon) | Linux (coming soon) |{" "}
          <a
            href="https://github.com/qontinui/qontinui-runner#installation"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Build from source
          </a>
        </p>

        <div className="mt-12 max-w-xl mx-auto">
          <Link href="/visual">
            <div className="group flex items-center gap-3 px-5 py-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-all duration-200 cursor-pointer">
              <Eye className="h-5 w-5 text-cyan-400 shrink-0" />
              <div className="text-left">
                <span className="text-sm font-medium text-cyan-300">
                  Visual GUI Automation
                </span>
                <span className="text-sm text-muted-foreground ml-2">
                  — Free, research-backed visual automation tool
                </span>
              </div>
              <ArrowRight className="h-4 w-4 text-cyan-400/60 group-hover:text-cyan-400 transition-colors ml-auto shrink-0" />
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
