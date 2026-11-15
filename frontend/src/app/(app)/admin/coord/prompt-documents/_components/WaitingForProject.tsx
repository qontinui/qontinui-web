/**
 * What a settings section shows while the page has no project to read its
 * settings in (`useFirstPinnedRead`). Nothing is read until the page knows
 * its project, and the section says so rather than show empty data or a
 * load that is not happening. If the page's provider never yields a project
 * (nothing stored, and its read failed), the line stays and nothing is read
 * or written. The section's own muted loading style.
 */
export function WaitingForProject({ testId }: { testId: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      Waiting for this page&apos;s project to be known before reading these
      settings.
    </p>
  );
}
