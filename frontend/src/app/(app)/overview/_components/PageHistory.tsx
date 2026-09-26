"use client";

/**
 * A page's version history: every saved version, newest first; any one can
 * be read, and an editor can restore it. Restoring writes a NEW version with
 * the old one's content — history is never rewritten, so a restore can itself
 * be undone the same way.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { useFocusAfterRender } from "@/components/overview/editing/focus";
import {
  VersionConflictError,
  describeWriteFailure,
  postWithVersion,
  readOverview,
} from "@/components/overview/editing/api";
import { formatRelativeTime } from "@/lib/time-utils";
import type {
  PageRecord,
  PageVersionList,
  PageVersionRecord,
} from "../_lib/pages";

type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: T };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PageHistory({
  page,
  canEdit,
  onRestored,
  uiBridgeId,
}: {
  page: PageRecord;
  canEdit: boolean;
  /** The page as the restore (or a newer save somebody else made) left it. */
  onRestored: (page: PageRecord) => void;
  uiBridgeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Loadable<PageVersionList>>({
    state: "loading",
  });
  const [shown, setShown] = useState<Loadable<PageVersionRecord> | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusAfterRender = useFocusAfterRender();
  // Which "Read version" request is current: a slower reply to an earlier
  // click (or one landing after Close) must not replace what is shown.
  const viewing = useRef(0);

  const announce = (text: string) => {
    setNotice(text);
    // The restore button is gone once the version closes; the outcome is
    // where focus goes, so a keyboard reader is not dropped to the page top.
    focusAfterRender(noticeRef);
  };

  const closeVersion = () => {
    viewing.current += 1;
    setShown(null);
  };

  // Re-read whenever the page moves on, so a save made while the panel is
  // open appears in it.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setVersions({ state: "loading" });
    readOverview<PageVersionList>(
      `pages/${encodeURIComponent(page.id)}/versions`
    ).then(
      (value) => live && setVersions({ state: "ready", value }),
      (err: unknown) =>
        live && setVersions({ state: "error", message: errorText(err) })
    );
    return () => {
      live = false;
    };
  }, [open, page.id, page.version]);

  const view = (version: number) => {
    const request = (viewing.current += 1);
    setNotice(null);
    setShown({ state: "loading" });
    readOverview<PageVersionRecord>(
      `pages/${encodeURIComponent(page.id)}/versions/${version}`
    ).then(
      (value) =>
        request === viewing.current && setShown({ state: "ready", value }),
      (err: unknown) =>
        request === viewing.current &&
        setShown({ state: "error", message: errorText(err) })
    );
  };

  const restore = async (version: number) => {
    setRestoring(true);
    setNotice(null);
    try {
      const saved = await postWithVersion<PageRecord>(
        `pages/${encodeURIComponent(page.id)}/versions/${version}/revert`,
        page.version
      );
      onRestored(saved);
      closeVersion();
      announce(
        saved.version === page.version
          ? `Version ${version} already matches the page, so nothing changed.`
          : `Version ${version} is restored, as version ${saved.version}.`
      );
    } catch (err) {
      if (err instanceof VersionConflictError) {
        onRestored(err.current as PageRecord);
        announce(
          "Somebody saved this page since you opened it, so nothing was restored. Their version is shown now; restore again if you still want to."
        );
      } else {
        announce(describeWriteFailure(err));
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="text-sm" data-ui-bridge-id={uiBridgeId}>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          closeVersion();
          setNotice(null);
        }}
        data-ui-bridge-id={`${uiBridgeId}.toggle`}
      >
        {open ? "Hide version history" : `Version history (${page.version})`}
      </Button>
      {notice && (
        <p
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          className="mt-2 text-sm text-foreground focus:outline-none"
          data-ui-bridge-id={`${uiBridgeId}.notice`}
        >
          {notice}
        </p>
      )}
      {open && (
        <div className="mt-3 space-y-4">
          {versions.state === "loading" && (
            <p className="text-muted-foreground">Loading versions…</p>
          )}
          {versions.state === "error" && (
            <p role="alert" className="text-destructive">
              Couldn&rsquo;t load the versions. {versions.message}
            </p>
          )}
          {versions.state === "ready" && (
            <ol
              className="divide-y divide-border rounded-md border border-border"
              data-ui-bridge-id={`${uiBridgeId}.list`}
            >
              {versions.value.versions.map((v) => {
                const current = v.version === versions.value.current_version;
                return (
                  <li
                    key={v.version}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="font-medium text-foreground">
                      Version {v.version}
                      {current && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (current)
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {formatRelativeTime(v.created_at)}
                      {v.created_by ? ` by ${v.created_by}` : ""}
                    </span>
                    {!current && (
                      <Button
                        variant="link"
                        size="sm"
                        className="ml-auto h-auto px-0"
                        onClick={() => view(v.version)}
                        data-ui-bridge-id={`${uiBridgeId}.view-${v.version}`}
                      >
                        Read version {v.version}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {shown?.state === "loading" && (
            <p className="text-muted-foreground">Loading that version…</p>
          )}
          {shown?.state === "error" && (
            <p role="alert" className="text-destructive">
              Couldn&rsquo;t load that version. {shown.message}
            </p>
          )}
          {shown?.state === "ready" && (
            <div
              className="rounded-md border border-border px-4 py-3"
              data-ui-bridge-id={`${uiBridgeId}.shown`}
            >
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <p className="text-foreground">
                  Version {shown.value.version}: {shown.value.title}
                </p>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoring}
                    onClick={() => void restore(shown.value.version)}
                    data-ui-bridge-id={`${uiBridgeId}.restore`}
                  >
                    {restoring ? "Restoring…" : "Restore this version"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={closeVersion}
                  data-ui-bridge-id={`${uiBridgeId}.close-version`}
                >
                  Close
                </Button>
              </div>
              {shown.value.body_md.trim() ? (
                <MarkdownView headingOffset={2}>
                  {shown.value.body_md}
                </MarkdownView>
              ) : (
                <p className="text-muted-foreground">This version was empty.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
