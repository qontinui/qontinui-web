/**
 * Where a published document came from: the repository file it mirrors (and
 * the sha), and the device and reported session that published its latest
 * version. Plan `2026-10-07-agents-publish-documents-to-the-project-overview`
 * D3, D6.
 */

import {
  mirrorsRepo,
  shortId,
  shortSha,
  sourceFileUrl,
  type PageRecord,
} from "../_lib/pages";

type Provenance = Pick<
  PageRecord,
  "source_repo" | "source_path" | "source_sha" | "via_device" | "via_session"
>;

/** The Documents-list chip on a document that mirrors a repository file;
 *  nothing for a document written here. */
export function MirrorsRepoChip({
  page,
  uiBridgeId,
}: {
  page: Provenance;
  uiBridgeId: string;
}) {
  if (!mirrorsRepo(page)) return null;
  const where = page.source_path
    ? `${page.source_repo}/${page.source_path}`
    : (page.source_repo as string);
  return (
    <span
      className="badge badge-info"
      title={`Mirrors ${where}`}
      data-ui-bridge-id={uiBridgeId}
    >
      Mirrors repo
    </span>
  );
}

const code = "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]";

/** "Mirrors `<repo>/<path>` @ `<sha>`" (linked to the file at that sha) and
 *  "Published by reported session … on device …" — whichever the document
 *  carries; nothing when it carries neither. */
export function DocumentProvenanceLine({
  page,
  uiBridgeId,
}: {
  page: Provenance;
  uiBridgeId: string;
}) {
  const mirrors = mirrorsRepo(page);
  const session = page.via_session || null;
  const device = page.via_device || null;
  if (!mirrors && !session && !device) return null;

  const where = page.source_path
    ? `${page.source_repo}/${page.source_path}`
    : (page.source_repo ?? "");
  const href = sourceFileUrl(page);
  const mirrorText = (
    <>
      <code className={code}>{where}</code>
      {page.source_sha && (
        <>
          {" "}
          @ <code className={code}>{shortSha(page.source_sha)}</code>
        </>
      )}
    </>
  );

  return (
    <div
      className="space-y-0.5 text-xs text-muted-foreground"
      data-ui-bridge-id={uiBridgeId}
    >
      {mirrors && (
        <p data-ui-bridge-id={`${uiBridgeId}.source`}>
          Mirrors{" "}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              title={
                page.source_sha
                  ? `This file at ${page.source_sha}, on GitHub`
                  : undefined
              }
              data-ui-bridge-id={`${uiBridgeId}.source-link`}
            >
              {mirrorText}
            </a>
          ) : (
            mirrorText
          )}
        </p>
      )}
      {(session || device) && (
        <p data-ui-bridge-id={`${uiBridgeId}.publisher`}>
          Published
          {session && (
            <>
              {" "}
              by reported session{" "}
              <code className={code} title={session}>
                {shortId(session)}
              </code>
            </>
          )}
          {device && (
            <>
              {" "}
              on device{" "}
              <code className={code} title={device}>
                {shortId(device)}
              </code>
            </>
          )}
        </p>
      )}
    </div>
  );
}
