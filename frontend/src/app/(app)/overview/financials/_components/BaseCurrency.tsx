"use client";

/**
 * The project's base currency, on the page that spends in it: shown to every
 * reader, and changeable by whoever the served permission for the `settings`
 * resource says may change it (`useCanEdit`). For anyone else, and until that
 * answer has arrived, the control is absent.
 *
 * It writes the one field and carries every other setting back unchanged
 * (`saveBaseCurrency`). A save built on settings somebody has since changed is
 * refused with a 409: the settings are read again, so the next save is built
 * on what is stored now, and nothing is written until the editor says so.
 *
 * The project a read answers for is the selection in `localStorage` when it is
 * sent; another tab can change it without this page knowing. These settings are
 * one replaced whole per project, and neither the body nor the answer names the
 * project, so a read taken while the selection was elsewhere is discarded and a
 * save is refused unless the selection is still this page's project. The backend
 * also sends a reader no longer a member of the selected project to their home
 * project, so a save and the re-read after a failed one first ask the catalog
 * which project it answers for (`confirmProject`). The save itself names this
 * page's project, so a token refresh that rebuilds the request mid-save keeps
 * it, and the backend refuses a save naming a project the caller is not in.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import {
  ResourceError,
  describeWriteFailure,
  fetchCatalog,
  isRefusal,
} from "@/components/overview/editing/api";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { readActiveTenantId } from "@/services/http-client";
import {
  SETTINGS,
  fetchSettings,
  saveBaseCurrency,
  type OverviewSettings,
} from "../../_lib/estimate-api";

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  /** Another tab selected a different project; its answer is not this one's. */
  | { state: "moved" }
  | { state: "ready"; settings: OverviewSettings };

const PROJECT_MOVED =
  "This page's project is no longer the selected one, so saving here would change a different project's settings. Nothing was saved. Reload this page, check which project it shows, and select the one you meant before saving.";
const PROJECT_UNKNOWN =
  "This browser isn't reporting which project is selected, so a save could land in the wrong one. Nothing was saved. Reload this page and try again; if this keeps happening, allow this site to store data in your browser.";
const LOST_AND_MOVED =
  "The save got no clear answer, so it may or may not have landed in this project, and this page's project is no longer the selected one, so it can't be checked from here. Reload this page, select this project and check its base currency before saving again.";

/** Thrown in place of settings read while another project was selected. */
class ProjectMoved extends Error {}

const READ_MOVED =
  "Another tab has selected a different project, so this page can't show this one's base currency. Reload this page to see the project that is selected now.";

/** Refuses unless the server, asked now, answers for `projectId`. */
async function confirmProject(projectId: string | null) {
  const { tenant_id: answering } = await fetchCatalog();
  if (answering !== projectId) throw new ProjectMoved();
}

/** The settings of `projectId`, or a refusal if the selection moved around the
 *  read. An unreadable selection (`null`) answers for the caller's home project
 *  and is let through here: showing it is harmless, and a save refuses it. */
async function readSettingsOf(projectId: string | null) {
  const elsewhere = () => {
    const selected = readActiveTenantId();
    return selected !== null && selected !== projectId;
  };
  if (elsewhere()) throw new ProjectMoved();
  const settings = await fetchSettings();
  if (elsewhere()) throw new ProjectMoved();
  return settings;
}

function failureText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function BaseCurrency({
  projectId,
  hold,
  onChanged,
}: {
  /** The project on screen. */
  projectId: string | null;
  /** The project list has not resolved, so a read could answer for the wrong
   *  project. */
  hold: boolean;
  /** The stored base currency moved, by this control or by somebody else:
   *  whatever else shows or uses it should read it again. */
  onChanged: () => void;
}) {
  const canEdit = useCanEdit(SETTINGS);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  /** The code being typed; `null` when the form is closed. */
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const changeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  /** A failed save left the settings possibly moved, and the read that would
   *  have shown it failed: the next good read owes the page its `onChanged`. */
  const owedChange = useRef(false);
  const errorId = useId();

  useEffect(() => {
    if (hold) return;
    let live = true;
    readSettingsOf(projectId).then(
      (settings) => live && setLoaded({ state: "ready", settings }),
      (err: unknown) =>
        live &&
        setLoaded(
          err instanceof ProjectMoved
            ? { state: "moved" }
            : { state: "error", message: failureText(err) }
        )
    );
    return () => {
      live = false;
    };
  }, [hold, projectId, readAttempt]);

  useEffect(() => {
    if (loaded.state === "ready" && owedChange.current) {
      owedChange.current = false;
      onChanged();
    }
  }, [loaded, onChanged]);

  useEffect(() => {
    if (draft === null && returnFocus.current) {
      returnFocus.current = false;
      changeButton.current?.focus();
    }
  }, [draft]);

  if (loaded.state === "loading")
    return (
      <Skeleton
        className="mt-6 h-5 w-48"
        data-ui-bridge-id="overview.costs.base-currency.loading"
      />
    );
  const tryAgain = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      // After a failed save the form that held focus has just gone.
      autoFocus={error !== null}
      onClick={() => {
        setError(null);
        setLoaded({ state: "loading" });
        setReadAttempt((n) => n + 1);
      }}
      data-ui-bridge-id="overview.costs.base-currency.retry"
    >
      Try again
    </Button>
  );
  if (loaded.state === "moved")
    return (
      <div className="mt-6 space-y-2">
        <p
          className="text-sm text-foreground"
          data-ui-bridge-id="overview.costs.base-currency.moved"
        >
          {READ_MOVED}
        </p>
        {tryAgain}
      </div>
    );
  if (loaded.state === "error")
    return (
      <div className="mt-6 space-y-2">
        <LoadFailure
          what="the base currency"
          message={loaded.message}
          uiBridgeId="overview.costs.base-currency.error"
          announce={false}
        />
        {error && (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-ui-bridge-id="overview.costs.base-currency.problem"
          >
            {error}
          </p>
        )}
        {tryAgain}
      </div>
    );

  const { settings } = loaded;
  const close = () => {
    returnFocus.current = true;
    setDraft(null);
    setError(null);
  };

  /** Why a save must not be sent now, if it must not. */
  const saveRefusal = () => {
    const selected = readActiveTenantId();
    if (selected === null || projectId === null) return PROJECT_UNKNOWN;
    return selected === projectId ? null : PROJECT_MOVED;
  };

  /** The read a failed save leaves us needing. `null` when it could not be
   *  trusted, having said why. */
  const reread = async (
    whenMoved: string,
    whenUnread: (err: unknown) => void
  ): Promise<OverviewSettings | null> => {
    try {
      await confirmProject(projectId);
      const fresh = await readSettingsOf(projectId);
      setLoaded({ state: "ready", settings: fresh });
      if (fresh.base_currency !== settings.base_currency) onChanged();
      return fresh;
    } catch (err) {
      if (err instanceof ProjectMoved) setError(whenMoved);
      else whenUnread(err);
      return null;
    }
  };

  /** Somebody saved first. Build the next attempt on what is stored now. */
  const reloadAfterConflict = async (wanted: string) => {
    const fresh = await reread(PROJECT_MOVED, (err) => {
      owedChange.current = true;
      setDraft(null);
      setError(
        "Somebody else changed this project's settings first. Nothing was saved, and the current settings could not be read."
      );
      setLoaded({ state: "error", message: failureText(err) });
    });
    if (!fresh) return;
    if (fresh.base_currency === wanted) {
      close();
      setNotice(`The base currency is already ${wanted}.`);
    } else {
      setError(
        `Somebody else changed this project's settings first, and the base currency is ${
          fresh.base_currency === settings.base_currency ? "still" : "now"
        } ${fresh.base_currency}. Nothing was saved. Save again to set it to ${wanted}.`
      );
    }
  };

  /** No clear answer (a 5xx, a timeout): the write may have landed. Find out. */
  const reconcileLostSave = async (wanted: string, failure: unknown) => {
    const fresh = await reread(LOST_AND_MOVED, (err) => {
      owedChange.current = true;
      setDraft(null);
      setError(
        "The save got no clear answer and the current settings could not be read, so whether it was saved is not known."
      );
      setLoaded({ state: "error", message: failureText(err) });
    });
    if (!fresh) return;
    // The version too: choosing a default as is leaves the code the same, so
    // the code alone can't show that anything landed.
    if (fresh.base_currency === wanted && fresh.version > settings.version) {
      close();
      setNotice(`Base currency set to ${wanted}. Nothing was converted.`);
    } else if (fresh.base_currency !== settings.base_currency) {
      setError(
        `${describeWriteFailure(failure)} Somebody else has changed the base currency to ${fresh.base_currency} meanwhile.`
      );
    } else {
      setError(describeWriteFailure(failure));
    }
  };

  const typed = draft?.trim().toUpperCase();
  const isCode = draft !== null && /^[A-Za-z]{3}$/.test(draft.trim());
  // A project on the defaults may choose the very code it already shows.
  const unchanged = typed === settings.base_currency && !settings.is_default;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null || saving) return;
    const code = draft.trim().toUpperCase();
    if (!isCode) {
      setError(
        code === ""
          ? "Enter a currency code such as USD or EUR."
          : `“${draft.trim()}” is not a currency. Use a code such as USD or EUR.`
      );
      return;
    }
    const refusal = saveRefusal();
    if (refusal) {
      setError(refusal);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await confirmProject(projectId);
    } catch (err) {
      setError(
        err instanceof ProjectMoved
          ? PROJECT_MOVED
          : "Couldn't confirm which project this would save to. Nothing was saved. Try again in a moment."
      );
      setSaving(false);
      return;
    }
    // The catalog read took time, and its answer covers only that request: the
    // selection could have moved since.
    const refusalNow = saveRefusal();
    if (refusalNow || projectId === null) {
      setError(refusalNow ?? PROJECT_UNKNOWN);
      setSaving(false);
      return;
    }
    try {
      const saved = await saveBaseCurrency(settings, code, projectId);
      setLoaded({ state: "ready", settings: saved });
      close();
      setNotice(
        `Base currency set to ${saved.base_currency}. Nothing was converted.`
      );
      onChanged();
    } catch (err) {
      if (err instanceof ResourceError && err.status === 409) {
        await reloadAfterConflict(code);
      } else if (
        err instanceof ResourceError &&
        err.code === "project_not_active"
      ) {
        setError(err.message);
      } else if (isRefusal(err)) {
        setError(describeWriteFailure(err));
      } else {
        await reconcileLostSave(code, err);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-6 text-sm"
      data-ui-bridge-id="overview.costs.base-currency"
    >
      {draft === null ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Base currency</span>
          <span
            className="font-medium text-foreground"
            data-ui-bridge-id="overview.costs.base-currency.value"
          >
            {settings.base_currency}
          </span>
          {settings.is_default && (
            <span
              className="text-xs text-muted-foreground"
              data-ui-bridge-id="overview.costs.base-currency.unset"
            >
              Default, not chosen yet
            </span>
          )}
          {canEdit && (
            <Button
              ref={changeButton}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNotice(null);
                setDraft(settings.base_currency);
              }}
              data-ui-bridge-id="overview.costs.base-currency.change"
            >
              Change
            </Button>
          )}
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
          onSubmit={(event) => void save(event)}
          noValidate
          data-ui-bridge-id="overview.costs.base-currency.form"
        >
          <label className="flex items-center gap-3">
            <span className="text-muted-foreground">Base currency</span>
            <Input
              autoFocus
              value={draft}
              autoComplete="off"
              spellCheck={false}
              readOnly={saving}
              aria-invalid={error !== null && !isCode}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              className="w-20 uppercase"
              data-ui-bridge-id="overview.costs.base-currency.input"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={saving || unchanged}
            data-ui-bridge-id="overview.costs.base-currency.save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={close}
            data-ui-bridge-id="overview.costs.base-currency.cancel"
          >
            Cancel
          </Button>
        </form>
      )}
      <p className="mt-1 max-w-[46rem] text-xs leading-relaxed text-muted-foreground">
        The default currency for a new recurring cost that names none; a one-off
        cost always names its own. Costs already recorded keep the currency they
        have: changing this converts nothing. Totals list this currency first.
      </p>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-destructive"
          data-ui-bridge-id="overview.costs.base-currency.problem"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-1 text-foreground"
          data-ui-bridge-id="overview.costs.base-currency.notice"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
