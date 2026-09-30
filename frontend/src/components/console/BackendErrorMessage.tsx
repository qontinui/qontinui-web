"use client";

/**
 * BackendErrorMessage — one backend refusal, rendered with its next action.
 *
 * **Supports R3/R8** of `frontend/docs/console-ui-style-guide.md` (see §3.2):
 * a refusal names who must act and how, in product words. Plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * Phase D3.
 *
 * Takes what a surface caught — a {@link BackendError} from
 * `backendError(res)`, any other `Error`, or a reading kept in state (see
 * {@link readingOf}) — and renders:
 *
 * - **A refusal envelope** (`data-refusal="structured"`): the sentence
 *   `Refusal::render()` produces; an action affordance for the two kinds that
 *   have one — `open_page` becomes a link, `run_command` a copyable command —
 *   and each cited glossary term through {@link GlossaryTerm}. The producer's
 *   raw `detail` is shown BESIDE the sentence, as the contract says, never
 *   folded into it.
 * - **Anything else** (`data-refusal="unstructured"`): exactly the sentence it
 *   showed before the contract existed, and nothing more. The label is what
 *   lets a scenario count the refusals an operator still meets without a next
 *   action.
 *
 * Presentation only: it reads nothing and fetches nothing.
 */

import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import {
  BackendError,
  isBackendErrorReading,
  plainSentence,
  MAX_CAUSE_LENGTH,
  type BackendErrorReading,
} from "@/lib/errors/backend-error-message";
import { quotable, type DecodedRefusal } from "@/lib/errors/refusal";
import { cn } from "@/lib/utils";
import { GlossaryTerm } from "./GlossaryTerm";

export interface BackendErrorMessageProps {
  /**
   * What the surface caught — or the reading it kept in state. A
   * {@link BackendError} or a {@link BackendErrorReading} renders that
   * reading; any other `Error` (or a string) renders as `unstructured` with
   * its message.
   */
  error: unknown;
  className?: string;
  "data-testid"?: string;
}

/** The reading behind whatever a surface caught. */
export function readingOf(error: unknown): BackendErrorReading {
  if (isBackendErrorReading(error)) return error;
  if (error instanceof BackendError) return error.reading;
  if (error instanceof Error) {
    return { kind: "unstructured", sentence: error.message };
  }
  return { kind: "unstructured", sentence: String(error) };
}

/**
 * Where an `open_page` target may be linked. An app path (`/admin/…`, not the
 * protocol-relative `//host`) or an absolute `http(s)` URL; anything else — a
 * `javascript:` URL above all — is never made clickable. The sentence already
 * names the target, so an unlinkable one loses nothing but the click.
 */
export function linkableTarget(
  target: string | null
): { href: string; external: boolean } | null {
  const t = target?.trim();
  if (!t) return null;
  if (t.startsWith("/") && !t.startsWith("//") && !t.startsWith("/\\")) {
    return { href: t, external: false };
  }
  try {
    const url = new URL(t);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return { href: url.toString(), external: true };
    }
  } catch {
    // Not a URL: not linkable.
  }
  return null;
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
        data-refusal-command
      >
        {command}
      </code>
      <button
        type="button"
        className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Copy command"
        title="Copy the command to the clipboard"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => setCopied(true),
            () => setCopied(false)
          );
        }}
      >
        {copied ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : (
          <Copy className="h-3 w-3" aria-hidden />
        )}
      </button>
    </span>
  );
}

function NextActionAffordance({ refusal }: { refusal: DecodedRefusal }) {
  const { kind, target } = refusal.next_action;
  if (kind === "open_page") {
    const link = linkableTarget(target);
    if (link === null) return null;
    return link.external ? (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2"
        data-refusal-action="open_page"
      >
        Open page
      </a>
    ) : (
      <Link
        href={link.href}
        className="font-medium underline underline-offset-2"
        data-refusal-action="open_page"
      >
        Open page
      </Link>
    );
  }
  if (kind === "run_command") {
    // The same cleaning the sentence applies, so the copied text is exactly
    // the command the sentence names.
    const command = quotable(target);
    if (command === null) return null;
    return (
      <span data-refusal-action="run_command">
        <CopyCommand command={command} />
      </span>
    );
  }
  return null;
}

export function BackendErrorMessage({
  error,
  className,
  "data-testid": testId,
}: BackendErrorMessageProps) {
  const reading = readingOf(error);
  if (reading.kind === "unstructured") {
    return (
      <span
        data-refusal="unstructured"
        data-testid={testId}
        className={className}
      >
        {reading.sentence}
      </span>
    );
  }
  const { refusal } = reading;
  const detail =
    refusal.detail !== null
      ? plainSentence(refusal.detail, MAX_CAUSE_LENGTH)
      : null;
  const hasTerms =
    refusal.glossary_terms.length > 0 ||
    refusal.unrecognised_glossary_terms.length > 0;
  return (
    <span
      data-refusal="structured"
      data-refusal-code={refusal.unrecognised_code ?? refusal.code}
      data-refusal-next-action={
        refusal.next_action.unrecognised_kind ?? refusal.next_action.kind
      }
      data-testid={testId}
      className={cn("inline-flex flex-col gap-1", className)}
    >
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-refusal-sentence>{reading.sentence}</span>
        <NextActionAffordance refusal={refusal} />
      </span>
      {detail !== null && (
        <span className="text-xs text-muted-foreground" data-refusal-detail>
          {detail}
        </span>
      )}
      {hasTerms && (
        <span className="text-xs text-muted-foreground" data-refusal-terms>
          Terms:{" "}
          {refusal.glossary_terms.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <GlossaryTerm id={id} />
            </span>
          ))}
          {refusal.unrecognised_glossary_terms.map((id, i) => (
            <span
              key={`unrecognised:${id}`}
              title="Not in this version's glossary"
              data-glossary-unrecognised={id}
            >
              {(i > 0 || refusal.glossary_terms.length > 0) && ", "}
              {id}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
