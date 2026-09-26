"use client";

/**
 * Uploaded files: a list anyone in the project can download from, and — for
 * an editor — a drop zone to add more and a way to delete one.
 *
 * What the server accepts is checked here first (type and size), so a reader
 * is told before a long upload rather than after it; the server checks again
 * against the bytes and its answer is shown as it gives it.
 */

import Link from "next/link";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useFocusAfterRender } from "@/components/overview/editing/focus";
import {
  describeWriteFailure,
  deleteResource,
  fetchFileBlob,
  isRefusal,
  uploadFile,
} from "@/components/overview/editing/api";
import type { ListState } from "@/components/overview/editing/useResource";
import { formatRelativeTime } from "@/lib/time-utils";
import { cn } from "@/lib/utils";
import {
  UPLOAD_ACCEPT,
  fileKindLabel,
  formatBytes,
  uploadProblem,
  type FileRecord,
} from "../_lib/pages";

type UploadRow = { id: string; name: string } & (
  | { state: "uploading" }
  | { state: "done" }
  /** `retry` is kept only when the upload may have been lost rather than
   *  refused: trying it again reuses the row's id as the Idempotency-Key, so
   *  a first attempt that did land is answered, not stored twice. */
  | { state: "failed"; message: string; retry: File | null }
);

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Offer a downloaded blob to the reader under the file's own name. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // After the click has handed the URL to the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function FilesPanel({
  files,
  canEdit,
  pageId,
  onChanged,
  attachedTo,
  emptyText,
  uiBridgeId,
}: {
  files: ListState<FileRecord>;
  canEdit: boolean;
  /** Attach uploads to this document. */
  pageId?: string;
  /** Called after an upload or a delete, to re-read the list. */
  onChanged: () => void;
  /** The document a file is attached to, to name it; null when unknown. */
  attachedTo?: (pageId: string) => { title: string; href: string } | null;
  emptyText: string;
  uiBridgeId: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Each row's Delete button, so "Keep it" can hand focus back to it.
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  // The panel itself stays mounted; focus goes there when an action removes
  // the button that took it (a retry, a delete).
  const panel = useRef<HTMLDivElement>(null);
  const focusAfterRender = useFocusAfterRender();

  const keep = (id: string) => {
    setConfirming(null);
    // Looked up when focus is given, not now: this row's Delete button is
    // unmounted while the question shows, and comes back with this render.
    focusAfterRender({
      get current() {
        return deleteButtons.current.get(id) ?? null;
      },
    });
  };

  // By id, not position: a second drop can land while the first uploads.
  const setRow = (row: UploadRow) =>
    setUploads((rows) => rows.map((r) => (r.id === row.id ? row : r)));

  /** Upload one file under its row's key; true when it landed. */
  const send = async (file: File, id: string): Promise<boolean> => {
    const name = file.name;
    const problem = uploadProblem(file);
    if (problem) {
      setRow({ id, name, state: "failed", message: problem, retry: null });
      return false;
    }
    setRow({ id, name, state: "uploading" });
    try {
      await uploadFile<FileRecord>(file, id, pageId);
      setRow({ id, name, state: "done" });
      return true;
    } catch (err) {
      setRow({
        id,
        name,
        state: "failed",
        message: describeWriteFailure(err),
        retry: isRefusal(err) ? null : file,
      });
      return false;
    }
  };

  const upload = async (picked: File[]) => {
    if (picked.length === 0) return;
    // The row's id doubles as the Idempotency-Key: one per file the reader
    // chose, reused by any retry of it.
    const jobs = picked.map((file) => ({ file, id: newKey() }));
    setUploads((prev) => [
      ...prev,
      ...jobs.map(
        ({ file, id }): UploadRow => ({
          id,
          name: file.name,
          state: "uploading",
        })
      ),
    ]);
    let any = false;
    // One at a time: the project's storage quota is checked per upload, and
    // a reader watching the list sees each file land in order.
    for (const { file, id } of jobs) {
      if (await send(file, id)) any = true;
    }
    if (any) onChanged();
  };

  const retry = async (file: File, id: string) => {
    focusAfterRender(panel);
    if (await send(file, id)) onChanged();
  };

  const download = async (file: FileRecord) => {
    setRowError(null);
    setDownloading(file.id);
    try {
      saveBlob(await fetchFileBlob(file.download_path), file.filename);
    } catch (err) {
      setRowError({
        id: file.id,
        message: `Couldn't download it. ${describeWriteFailure(err)}`,
      });
    } finally {
      setDownloading(null);
    }
  };

  const remove = async (file: FileRecord) => {
    setRowError(null);
    try {
      await deleteResource<FileRecord>("files", file.id, file.version);
      setConfirming(null);
      focusAfterRender(panel);
      onChanged();
    } catch (err) {
      setRowError({ id: file.id, message: describeWriteFailure(err) });
    }
  };

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="region"
      aria-label="Files"
      className="space-y-4 focus:outline-none"
      data-ui-bridge-id={uiBridgeId}
    >
      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-md border border-dashed px-4 py-4 text-sm",
            dragging ? "border-primary bg-muted/40" : "border-border"
          )}
          data-ui-bridge-id={`${uiBridgeId}.drop`}
        >
          <Upload className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">Drop files here, or</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => input.current?.click()}
            data-ui-bridge-id={`${uiBridgeId}.choose`}
          >
            Choose files
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Files to upload"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              void upload(picked);
            }}
            data-ui-bridge-id={`${uiBridgeId}.input`}
          />
          <span className="basis-full text-xs text-muted-foreground">
            PDF, Word, Excel, PowerPoint, PNG, JPEG, Markdown or CSV, up to 25
            MB each.
          </span>
        </div>
      )}

      {/* Always mounted, even empty: a live region that appears together
          with its first message is often not announced at all. */}
      <ul
        aria-live="polite"
        className={cn("space-y-1 text-sm", uploads.length === 0 && "sr-only")}
        data-ui-bridge-id={`${uiBridgeId}.uploads`}
      >
        {uploads.map((row) => (
          <li
            key={row.id}
            className={
              row.state === "failed"
                ? "text-destructive"
                : "text-muted-foreground"
            }
          >
            {row.state === "uploading" && `Uploading ${row.name}…`}
            {row.state === "done" && `Uploaded ${row.name}.`}
            {row.state === "failed" && row.message}
            {row.state === "failed" && row.retry && (
              <Button
                variant="link"
                size="sm"
                className="ml-2 h-auto px-0"
                onClick={() => row.retry && void retry(row.retry, row.id)}
                data-ui-bridge-id={`${uiBridgeId}.retry-${row.id}`}
              >
                Try {row.name} again
              </Button>
            )}
          </li>
        ))}
      </ul>

      {files.state === "loading" && (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      )}
      {files.state === "error" && (
        <LoadFailure
          what="the uploaded files"
          message={files.message}
          announce={false}
          uiBridgeId={`${uiBridgeId}.error`}
        />
      )}
      {files.state === "ready" &&
        (files.items.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-ui-bridge-id={`${uiBridgeId}.empty`}
          >
            {emptyText}
          </p>
        ) : (
          <ul
            className="divide-y divide-border rounded-md border border-border"
            data-ui-bridge-id={`${uiBridgeId}.list`}
          >
            {files.items.map((file) => {
              const attached = file.page_id
                ? (attachedTo?.(file.page_id) ?? null)
                : null;
              return (
                <li key={file.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Button
                      variant="link"
                      className="h-auto px-0 text-[15px]"
                      disabled={downloading === file.id}
                      onClick={() => void download(file)}
                      data-ui-bridge-id={`${uiBridgeId}.download-${file.id}`}
                    >
                      {file.filename}
                    </Button>
                    <span className="text-muted-foreground">
                      {fileKindLabel(file)} · {formatBytes(file.size_bytes)} ·{" "}
                      {formatRelativeTime(file.created_at)}
                      {file.uploaded_by ? ` by ${file.uploaded_by}` : ""}
                    </span>
                    {canEdit && confirming !== file.id && (
                      <Button
                        ref={(el: HTMLButtonElement | null) => {
                          if (el) deleteButtons.current.set(file.id, el);
                          else deleteButtons.current.delete(file.id);
                        }}
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setConfirming(file.id)}
                        aria-label={`Delete ${file.filename}`}
                        data-ui-bridge-id={`${uiBridgeId}.delete-${file.id}`}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                  {attached && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Attached to{" "}
                      <Link
                        href={attached.href}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {attached.title}
                      </Link>
                    </p>
                  )}
                  {confirming === file.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-foreground">
                        Delete {file.filename}? This can&rsquo;t be undone.
                      </span>
                      <DestructiveButton
                        size="sm"
                        onClick={() => void remove(file)}
                        data-ui-bridge-id={`${uiBridgeId}.confirm-delete-${file.id}`}
                      >
                        Delete it
                      </DestructiveButton>
                      <Button
                        size="sm"
                        variant="ghost"
                        // The safe choice takes focus when the question opens.
                        autoFocus
                        onClick={() => keep(file.id)}
                        data-ui-bridge-id={`${uiBridgeId}.keep-${file.id}`}
                      >
                        Keep it
                      </Button>
                    </div>
                  )}
                  {rowError?.id === file.id && (
                    <p role="alert" className="mt-1 text-destructive">
                      {rowError.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
