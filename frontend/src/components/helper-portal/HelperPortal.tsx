"use client";

/**
 * The /help helper portal — one task at a time, three big answers.
 *
 * Audience is a non-technical helper on a phone/tablet/laptop, so the UX
 * rules are strict: one full-screen card, the question in large text, a
 * screenshot when there is one, and three big high-contrast buttons
 * (👍 Looks right / 👎 Something's wrong / 🤔 Not sure). A 👎 opens plain-
 * language reason chips (+ optional free text) with a single Send button.
 * Answers advance optimistically; the queue-empty and queue-unavailable
 * states are friendly and jargon-free.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  errorStatus,
  fetchHelperStatus,
  fetchHelperTasks,
  submitHelperAnswer,
} from "./api";
import { humanizeReason } from "./humanize";
import type { HelperTask, HelperVerdict } from "./types";

// ---------------------------------------------------------------------------
// "Helped today" counter — session-scoped, keyed by date so the "you helped
// with N things today" message resets each day.
// ---------------------------------------------------------------------------

const HELPED_KEY = "qontinui.helper_helped_today";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function readHelpedToday(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(HELPED_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day?: string; count?: number };
    if (parsed.day !== todayStamp()) return 0;
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function writeHelpedToday(count: number): void {
  try {
    window.sessionStorage.setItem(
      HELPED_KEY,
      JSON.stringify({ day: todayStamp(), count })
    );
  } catch {
    // Best-effort only.
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Phase =
  | "loading" // initial queue fetch in flight
  | "task" // showing the current task's three buttons
  | "reject" // reason chips + optional free text for a 👎
  | "sending" // answer POST in flight (buttons disabled)
  | "thanks" // brief "Thank you — N left" before auto-advance
  | "empty" // queue exhausted / nothing available
  | "error"; // an answer failed to send — offer retry

const THANKS_MS = 1200;

export function HelperPortal() {
  const { user, logout } = useAuth();
  const [queue, setQueue] = useState<HelperTask[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [helpedToday, setHelpedToday] = useState(0);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [sendError, setSendError] = useState(false);
  // Overrides the default "Thank you" line — used when a task turned out to
  // be already handled (404/409) and we advance without recording an answer.
  const [thanksNote, setThanksNote] = useState<string | null>(null);
  // /help is a bookmark-magnet from when it was the docs page — show
  // non-helper visitors a quiet way to the developer docs. Hidden for
  // helper-only users (the docs are not for them); shown on status errors
  // so a docs-seeker is never stranded.
  const [showDocsLink, setShowDocsLink] = useState(false);

  const current = queue[0];

  useEffect(() => {
    setHelpedToday(readHelpedToday());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchHelperStatus()
      .then((status) => {
        if (!cancelled) setShowDocsLink(!status.is_helper_only);
      })
      .catch(() => {
        if (!cancelled) setShowDocsLink(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadQueue = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetchHelperTasks();
      const open = res.available ? res.tasks : [];
      setQueue(open);
      setPhase(open.length > 0 ? "task" : "empty");
    } catch {
      // Treat a failed fetch the same as an empty/unavailable queue — the
      // helper should see a friendly message, never an error wall.
      setQueue([]);
      setPhase("empty");
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const advance = useCallback(() => {
    setSelectedReasons([]);
    setFreeText("");
    setSendError(false);
    setQueue((q) => {
      const rest = q.slice(1);
      setPhase(rest.length > 0 ? "task" : "empty");
      return rest;
    });
  }, []);

  const sendAnswer = useCallback(
    async (verdict: HelperVerdict, reasons: string[], note: string) => {
      if (!current) return;
      setPhase("sending");
      setSendError(false);
      const trimmed = note.trim();
      try {
        await submitHelperAnswer(current.id, {
          verdict,
          reasons,
          free_text: trimmed.length > 0 ? trimmed : null,
        });
      } catch (err) {
        const status = errorStatus(err);
        if (status === 404 || status === 409) {
          // Permanent: the task is gone or already answered — retrying can
          // never succeed. Say so briefly and move on to the next one.
          setThanksNote("This one’s already been handled — moving on!");
          setPhase("thanks");
          window.setTimeout(advance, THANKS_MS);
          return;
        }
        // Transient — the tap must never be silently dropped; offer retry.
        setSendError(true);
        setPhase(verdict === "reject" ? "reject" : "error");
        return;
      }
      const next = helpedToday + 1;
      setHelpedToday(next);
      writeHelpedToday(next);
      setThanksNote(null);
      setPhase("thanks");
      window.setTimeout(advance, THANKS_MS);
    },
    [advance, current, helpedToday]
  );

  const toggleReason = useCallback((code: string) => {
    setSelectedReasons((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }, []);

  const schema = current?.answerSchema;
  const showNotSure = useMemo(
    () =>
      Boolean(
        schema && schema.allowNotSure && schema.verdicts.includes("not_sure")
      ),
    [schema]
  );

  const remainingAfterCurrent = Math.max(queue.length - 1, 0);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Slim header — no app shell, just who you are + a way out. */}
      <header className="flex items-center justify-between px-5 py-4">
        <span className="text-base font-semibold tracking-tight text-muted-foreground">
          Qontinui
        </span>
        <div className="flex items-center gap-4">
          {user?.email ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        {phase === "loading" ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-10 animate-spin text-muted-foreground" />
            <p className="text-xl text-muted-foreground">
              Looking for things you can help with…
            </p>
          </div>
        ) : null}

        {phase === "empty" ? (
          <div className="mx-auto max-w-xl text-center">
            <div className="mb-6 text-6xl">🎉</div>
            <h1 className="mb-4 text-3xl font-bold sm:text-4xl">All done!</h1>
            <p className="text-xl leading-relaxed text-muted-foreground">
              {helpedToday > 0
                ? `You helped with ${helpedToday} ${
                    helpedToday === 1 ? "thing" : "things"
                  } today. Check back later.`
                : "There is nothing to look at right now. Check back later."}
            </p>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="mt-8 rounded-2xl border-2 border-border px-8 py-4 text-xl font-semibold hover:bg-muted"
            >
              Check again
            </button>
          </div>
        ) : null}

        {phase === "thanks" ? (
          <div className="mx-auto max-w-xl text-center">
            <div className="mb-6 text-6xl">🙌</div>
            <h1 className="text-3xl font-bold sm:text-4xl">
              {thanksNote ?? (
                <>
                  Thank you —{" "}
                  {remainingAfterCurrent === 0
                    ? "that was the last one!"
                    : `${remainingAfterCurrent} left`}
                </>
              )}
            </h1>
          </div>
        ) : null}

        {current &&
        (phase === "task" || phase === "sending" || phase === "error") ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8">
            <h1 className="text-center text-3xl font-bold leading-snug sm:text-4xl">
              {current.prompt}
            </h1>

            {current.payload.screenshotUrl ? (
              // Plain <img>: screenshot URLs are presigned/coord-served and
              // not statically known, so next/image remote-domain config
              // does not apply here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.payload.screenshotUrl}
                alt="The screen to look at"
                className="max-h-[45dvh] w-auto max-w-full rounded-xl border-2 border-border object-contain shadow-lg"
              />
            ) : null}

            {sendError && phase === "error" ? (
              <p className="text-center text-lg font-semibold text-red-400">
                That didn’t go through. Please try again.
              </p>
            ) : null}

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              <button
                type="button"
                disabled={phase === "sending"}
                onClick={() => void sendAnswer("approve", [], "")}
                className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-green-600 px-6 py-5 text-xl font-bold text-white shadow-lg transition-transform hover:scale-[1.02] hover:bg-green-500 disabled:opacity-60"
              >
                <span className="text-3xl" aria-hidden>
                  👍
                </span>
                Looks right
              </button>
              <button
                type="button"
                disabled={phase === "sending"}
                onClick={() => {
                  setSendError(false);
                  setPhase("reject");
                }}
                className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-red-600 px-6 py-5 text-xl font-bold text-white shadow-lg transition-transform hover:scale-[1.02] hover:bg-red-500 disabled:opacity-60"
              >
                <span className="text-3xl" aria-hidden>
                  👎
                </span>
                Something’s wrong
              </button>
              {showNotSure ? (
                <button
                  type="button"
                  disabled={phase === "sending"}
                  onClick={() => void sendAnswer("not_sure", [], "")}
                  className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-amber-500 px-6 py-5 text-xl font-bold text-black shadow-lg transition-transform hover:scale-[1.02] hover:bg-amber-400 disabled:opacity-60"
                >
                  <span className="text-3xl" aria-hidden>
                    🤔
                  </span>
                  Not sure
                </button>
              ) : null}
            </div>

            {phase === "sending" ? (
              <p className="flex items-center gap-2 text-lg text-muted-foreground">
                <Loader2 className="size-5 animate-spin" /> Sending…
              </p>
            ) : null}
          </div>
        ) : null}

        {current && phase === "reject" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-7">
            <h1 className="text-center text-3xl font-bold leading-snug sm:text-4xl">
              What looks wrong?
            </h1>
            <p className="text-center text-lg text-muted-foreground">
              Tap everything that fits.
            </p>

            {sendError ? (
              <p className="text-center text-lg font-semibold text-red-400">
                That didn’t go through. Please try again.
              </p>
            ) : null}

            {schema && schema.presetReasons.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-3">
                {schema.presetReasons.map((code) => {
                  const selected = selectedReasons.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleReason(code)}
                      aria-pressed={selected}
                      className={
                        selected
                          ? "rounded-full border-2 border-red-500 bg-red-600 px-6 py-3 text-lg font-semibold text-white shadow"
                          : "rounded-full border-2 border-border bg-transparent px-6 py-3 text-lg font-semibold hover:bg-muted"
                      }
                    >
                      {humanizeReason(code)}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {schema?.allowFreeText ? (
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Anything else you noticed? (optional)"
                rows={3}
                className="w-full max-w-xl rounded-xl border-2 border-border bg-background px-4 py-3 text-lg placeholder:text-muted-foreground focus:border-red-500 focus:outline-none"
              />
            ) : null}

            <div className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setSelectedReasons([]);
                  setFreeText("");
                  setSendError(false);
                  setPhase("task");
                }}
                className="min-h-16 flex-1 rounded-2xl border-2 border-border px-6 py-4 text-xl font-semibold hover:bg-muted"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() =>
                  void sendAnswer("reject", selectedReasons, freeText)
                }
                className="min-h-16 flex-1 rounded-2xl bg-red-600 px-6 py-4 text-xl font-bold text-white shadow-lg hover:bg-red-500"
              >
                Send
              </button>
            </div>
          </div>
        ) : null}
      </main>

      {showDocsLink ? (
        <footer className="px-5 pb-4 text-center text-sm text-muted-foreground">
          Looking for the developer docs?{" "}
          <Link
            href="/help/docs"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Go to the docs
          </Link>
        </footer>
      ) : null}
    </div>
  );
}
