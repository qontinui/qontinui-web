"use client";

import { useState, useCallback } from "react";
import {
  Camera,
  ExternalLink,
  Terminal as TerminalIcon,
  Code2,
} from "lucide-react";
import type { VerificationStepResult } from "@/types/task-runs";
import { screenshotUrl, TEXT_PREVIEW_LIMIT } from "./utils";

function CollapsibleTextBlock({
  label,
  icon,
  text,
  className = "",
  defaultCollapsed = false,
}: {
  label: string;
  icon: React.ReactNode;
  text: string;
  className?: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const isLong = text.length > TEXT_PREVIEW_LIMIT;
  const displayText =
    collapsed && isLong ? text.slice(0, TEXT_PREVIEW_LIMIT) + "..." : text;

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1 hover:text-text-secondary transition-colors"
      >
        {icon}
        {label}
        {isLong && (
          <span className="text-[10px] text-brand-secondary ml-1">
            {collapsed ? "Show more" : "Show less"}
          </span>
        )}
      </button>
      <pre
        className={`text-xs bg-surface-canvas/50 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto ${className}`}
      >
        {displayText}
      </pre>
    </div>
  );
}

function ScreenshotEvidence({ path }: { path: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const url = screenshotUrl(path);
  const filename = path.split("/").pop() || path.split("\\").pop() || path;

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setError(true), []);

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted bg-surface-canvas/50 px-3 py-2 rounded">
        <Camera className="w-3 h-3" />
        <span>Screenshot unavailable: {filename}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
        <Camera className="w-3 h-3" />
        Screenshot
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-brand-secondary hover:underline inline-flex items-center gap-0.5"
          title="Open full-size in new tab"
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
      <div
        className="relative bg-surface-canvas/50 rounded overflow-hidden cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {!loaded && (
          <div className="h-32 flex items-center justify-center text-text-muted text-xs">
            Loading screenshot...
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`Verification screenshot: ${filename}`}
          className={`w-full rounded transition-all ${
            expanded ? "max-h-none" : "max-h-[200px] object-cover object-top"
          } ${loaded ? "block" : "hidden"}`}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
        />
        {loaded && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-surface-canvas/80 to-transparent flex items-end justify-center pb-1">
            <span className="text-[10px] text-text-muted">Click to expand</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function EvidenceSection({ step }: { step: VerificationStepResult }) {
  const details = step.verification_details;

  const hasScreenshot = !!step.screenshot_path;
  const hasPageSnapshot = !!details?.page_snapshot;
  const hasLogOutput =
    !!step.output_data?.log_output || !!step.output_data?.console_output;

  if (!hasScreenshot && !hasPageSnapshot && !hasLogOutput) {
    return null;
  }

  return (
    <div className="border-t border-border-subtle/20 pt-3 mt-1">
      <div className="text-[10px] font-medium text-text-muted mb-2 uppercase tracking-wider">
        Evidence
      </div>
      <div className="space-y-2">
        {hasScreenshot && <ScreenshotEvidence path={step.screenshot_path!} />}

        {hasLogOutput && (
          <CollapsibleTextBlock
            label="Log Output"
            icon={<TerminalIcon className="w-3 h-3" />}
            text={
              (step.output_data?.log_output as string) ||
              (step.output_data?.console_output as string) ||
              ""
            }
            className="text-text-secondary"
            defaultCollapsed
          />
        )}

        {hasPageSnapshot && (
          <CollapsibleTextBlock
            label="DOM Snapshot"
            icon={<Code2 className="w-3 h-3" />}
            text={details!.page_snapshot!}
            className="text-text-secondary"
            defaultCollapsed
          />
        )}
      </div>
    </div>
  );
}
