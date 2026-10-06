"use client";

/** Name a new document or wiki page; it opens once created. */

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createResource,
  describeWriteFailure,
  isRefusal,
} from "@/components/overview/editing/api";
import { slugify } from "@/components/overview/wiki-links";
import type { PageKind, PageRecord } from "../_lib/pages";

const NOUN: Record<PageKind, string> = {
  document: "document",
  wiki: "wiki page",
};

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NewPageForm({
  kind,
  initialTitle = "",
  onCreated,
  onCancel,
  uiBridgeId,
}: {
  kind: PageKind;
  initialTitle?: string;
  onCreated: (page: PageRecord) => void;
  onCancel?: () => void;
  uiBridgeId: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per page the reader means to create. Kept across a LOST attempt
  // (a timeout, a dropped connection, a 5xx), so creating again answers with
  // the page that attempt may have made; replaced after a refusal, which made
  // nothing. A different title is a different page, so it gets a new key too.
  const key = useRef<{ value: string; title: string } | null>(null);
  const inputId = useId();
  const errorId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!slugify(trimmed)) {
      setError("Give it a name with at least one letter or number.");
      return;
    }
    if (key.current?.title !== trimmed) {
      key.current = { value: newKey(), title: trimmed };
    }
    setSaving(true);
    setError(null);
    try {
      const page = await createResource<PageRecord>(
        "pages",
        { kind, title: trimmed, body_md: "" },
        key.current.value
      );
      onCreated(page);
    } catch (err) {
      setError(describeWriteFailure(err));
      if (isRefusal(err)) key.current = null;
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-wrap items-end gap-3 rounded-md border border-border px-4 py-4"
      data-ui-bridge-id={uiBridgeId}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="text-sm text-muted-foreground">
          Name of the new {NOUN[kind]}
        </label>
        <Input
          id={inputId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
          aria-invalid={error !== null || undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-1"
          data-ui-bridge-id={`${uiBridgeId}.title`}
        />
      </div>
      <Button
        type="submit"
        disabled={saving}
        data-ui-bridge-id={`${uiBridgeId}.create`}
      >
        {saving ? "Creating…" : `Create ${NOUN[kind]}`}
      </Button>
      {onCancel && (
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          data-ui-bridge-id={`${uiBridgeId}.cancel`}
        >
          Cancel
        </Button>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="basis-full text-sm text-destructive"
          data-ui-bridge-id={`${uiBridgeId}.error`}
        >
          {error}
        </p>
      )}
    </form>
  );
}
