"use client";

/** Rename a page in place. The address (slug) stays: links name it. */

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SaveResult } from "@/components/overview/editing/useResource";
import type { PageRecord } from "../_lib/pages";

export function TitleEditor({
  page,
  save,
  onDone,
  uiBridgeId,
}: {
  page: PageRecord;
  save: (
    page: PageRecord,
    patch: Record<string, unknown>
  ) => Promise<SaveResult<PageRecord>>;
  onDone: () => void;
  uiBridgeId: string;
}) {
  const [title, setTitle] = useState(page.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("A page needs a name.");
      return;
    }
    if (trimmed === page.title) {
      onDone();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await save(page, { title: trimmed });
    setSaving(false);
    if (result.ok) {
      onDone();
    } else if ("conflict" in result) {
      setTitle(result.conflict.title);
      setError(
        "Somebody saved this page since you opened it. Their version is shown now; rename it again if you still want to."
      );
    } else {
      setError(result.error);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-wrap items-end gap-3"
      data-ui-bridge-id={uiBridgeId}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="text-sm text-muted-foreground">
          Name
        </label>
        <Input
          id={inputId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
          className="mt-1 text-lg"
          data-ui-bridge-id={`${uiBridgeId}.title`}
        />
      </div>
      <Button
        type="submit"
        disabled={saving}
        data-ui-bridge-id={`${uiBridgeId}.save`}
      >
        {saving ? "Saving…" : "Save name"}
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <p className="basis-full text-xs text-muted-foreground">
        Links to this page keep working: its address, {page.slug}, stays the
        same.
      </p>
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
