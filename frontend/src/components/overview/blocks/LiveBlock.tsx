"use client";

/**
 * One fenced block in overview markdown, rendered as its live component (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2).
 *
 * `MarkdownView` hands over the fence's language (the block's name), its
 * info-string meta and its body. This looks the name up in the registry, reads
 * the settings with the strict grammar (`parseBlockArgs`), checks them against
 * the block's schema, and renders the block. Two failures are SAID, never
 * rendered as a silent nothing:
 *
 * - a name that looks like a block but is not one: "This block isn't
 *   available: `<name>`";
 * - settings that do not parse or do not validate: "This block's settings
 *   aren't valid", naming the setting that failed.
 *
 * A report block shows the report its `report:` setting names, or else the
 * report the page is bound to (D3 "Binding"); with neither, that missing
 * setting is the error.
 */

import type { ReactNode } from "react";
import type { ZodError } from "zod";
import { z } from "zod";
import type { BlockArgsError } from "./parseBlockArgs";
import { parseBlockArgs } from "./parseBlockArgs";
import { BlockNotice } from "./blockChrome";
import { ReportSourceBoundary, useBoundReport } from "./ReportContext";
import { findBlock, type BlockEntry } from "./registry";

function Frame({
  name,
  kind,
  children,
}: {
  name: string;
  kind: "unknown" | "settings";
  children: ReactNode;
}) {
  return (
    <div
      className="not-prose my-6 rounded-md border border-border p-4 text-sm"
      data-overview-block={name}
      data-overview-block-error={kind}
      data-ui-bridge-id={`overview.block.${kind === "unknown" ? "unknown" : "settings-error"}`}
    >
      {children}
    </div>
  );
}

/** The plain words for a setting's schema: what it may be. */
function hint(schema: z.AnyZodObject, key: string): string | null {
  const field = schema.shape[key] as z.ZodTypeAny | undefined;
  if (!field) return null;
  return (
    field.description ??
    (field instanceof z.ZodOptional
      ? (field.unwrap() as z.ZodTypeAny).description
      : undefined) ??
    null
  );
}

/** The first schema failure, said in a sentence naming its setting. */
export function describeSettingsError(
  error: ZodError,
  schema: z.AnyZodObject
): BlockArgsError {
  const issue = error.issues[0];
  const key = typeof issue?.path[0] === "string" ? issue.path[0] : null;
  if (key === null) {
    return { key: null, message: "These settings can't be read." };
  }
  const may = hint(schema, key);
  const missing =
    issue?.code === "invalid_type" && issue.received === "undefined";
  return {
    key,
    message: missing
      ? `This block needs \`${key}\`${may ? `: ${may}` : ""}.`
      : `\`${key}\` isn't a value this block accepts${may ? `: use ${may}` : ""}.`,
  };
}

function SettingsError({
  name,
  error,
}: {
  name: string;
  error: BlockArgsError;
}) {
  return (
    <Frame name={name} kind="settings">
      <BlockNotice
        tone="problem"
        title="This block's settings aren't valid"
        detail={
          <>
            {error.key && (
              <>
                Check <code data-setting={error.key}>{error.key}</code>.{" "}
              </>
            )}
            {error.message}
          </>
        }
      />
    </Frame>
  );
}

function Settled({
  entry,
  args,
  bound,
}: {
  entry: BlockEntry;
  args: Record<string, unknown>;
  bound: string | null;
}) {
  if (entry.kind === "report") {
    const named = typeof args.report === "string" ? args.report : null;
    const slug = named ?? bound;
    if (slug === null) {
      return (
        <SettingsError
          name={entry.name}
          error={{
            key: "report",
            message:
              "Outside a report's own page, a report block names the report it shows: add a line report: <the report's name>.",
          }}
        />
      );
    }
    const Component = entry.component;
    return (
      <ReportSourceBoundary>
        <Component args={args} report={slug} />
      </ReportSourceBoundary>
    );
  }
  const Component = entry.component;
  return <Component args={args} />;
}

export function LiveBlock({
  name,
  meta,
  body,
}: {
  /** The fence's language. */
  name: string;
  /** The rest of the fence's first line, after the name. */
  meta: string | null;
  /** The fence's text. */
  body: string;
}) {
  const bound = useBoundReport();
  const entry = findBlock(name);
  if (!entry) {
    return (
      <Frame name={name} kind="unknown">
        <BlockNotice
          tone="problem"
          title={
            <>
              This block isn&rsquo;t available: <code>{name}</code>
            </>
          }
          detail="Its name may be misspelled, or it may be a block this overview does not have."
        />
      </Frame>
    );
  }
  const parsed = parseBlockArgs(meta, body, {
    keys: Object.keys(entry.args.shape),
    positional: entry.positional,
  });
  if (!parsed.ok) return <SettingsError name={name} error={parsed.error} />;
  const checked = entry.args.safeParse(parsed.args);
  if (!checked.success) {
    return (
      <SettingsError
        name={name}
        error={describeSettingsError(checked.error, entry.args)}
      />
    );
  }
  return (
    <Settled
      entry={entry}
      args={checked.data as Record<string, unknown>}
      bound={bound}
    />
  );
}
