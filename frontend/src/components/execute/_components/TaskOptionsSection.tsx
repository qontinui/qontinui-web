"use client";

interface TaskOptionsSectionProps {
  autoFixOnFailure: boolean;
  setAutoFixOnFailure: (v: boolean) => void;
  skipIfCompleted: boolean;
  setSkipIfCompleted: (v: boolean) => void;
}

export function TaskOptionsSection({
  autoFixOnFailure,
  setAutoFixOnFailure,
  skipIfCompleted,
  setSkipIfCompleted,
}: TaskOptionsSectionProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoFixOnFailure}
          onChange={(e) => setAutoFixOnFailure(e.target.checked)}
          className="rounded border-border-subtle"
        />
        <span className="text-sm text-text-secondary">Auto-fix on failure</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={skipIfCompleted}
          onChange={(e) => setSkipIfCompleted(e.target.checked)}
          className="rounded border-border-subtle"
        />
        <span className="text-sm text-text-secondary">
          Skip if already completed
        </span>
      </label>
    </div>
  );
}
