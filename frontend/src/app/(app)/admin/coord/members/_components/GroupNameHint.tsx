"use client";

/**
 * The inline validation line under a group-name input: the reason, and the
 * one-click fix where one exists.
 *
 * `role="alert"` because the message appears as the operator types — a
 * screen-reader user who has already moved past the field would otherwise
 * never learn the submit button went away.
 *
 * That announcement fires ONCE, though, and only for whoever was listening at
 * the time. So the message also carries `id={testId}` for the input's
 * `aria-describedby`: a screen-reader user who tabs back to the field — or who
 * reaches it for the first time after the value was pasted or filled — hears
 * the reason along with the `aria-invalid` state, instead of "invalid entry"
 * and nothing else. Announcement and association answer different questions
 * and neither substitutes for the other.
 */
export function GroupNameHint({
  problem,
  suggestion,
  onAccept,
  testId,
}: {
  problem: string | null;
  suggestion: string | null;
  onAccept: (value: string) => void;
  testId: string;
}) {
  if (!problem) return null;
  return (
    <p
      id={testId}
      className="text-xs text-destructive flex flex-wrap items-center gap-1.5"
      role="alert"
      data-testid={testId}
    >
      <span>{problem}</span>
      {suggestion && (
        <button
          type="button"
          className="underline underline-offset-2 hover:no-underline"
          onClick={() => onAccept(suggestion)}
          data-testid={`${testId}-fix`}
        >
          Use “{suggestion}”
        </button>
      )}
    </p>
  );
}
