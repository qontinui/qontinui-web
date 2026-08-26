"use client";

/**
 * The archived body: what it is, what its digest does and does not prove, and
 * the verbatim export.
 *
 * Plan §5, "Two ingest paths, one digest". The corpus has two possible body
 * writers and only ONE of them produces bytes that can be checked against the
 * session's original file:
 *
 * * `disk_verbatim` — the runner read the JSONL off disk and uploaded it
 *   unmodified. `content_sha256` verifies against the original.
 * * `coord_redacted` — the body was recovered from coord's transcript stream,
 *   which redacts unconditionally on the way in. The digest describes the
 *   stored bytes and NOTHING ELSE.
 *
 * So this panel never prints the bare word "verified". Even the in-browser
 * re-hash below — which really does check the downloaded bytes against the
 * recorded digest — is reported as "the stored copy is intact", and for a
 * redacted body it says in the same breath that this is still not a check
 * against the original.
 */

import { useState } from "react";
import {
  CheckCircle2,
  Download,
  FileWarning,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DigestBadge, SecretFindingsBadge } from "./HonestyBadges";
import { exportSessionBody } from "./api";
import {
  digestClaim,
  digestClaimAgreesWithServer,
  displayName,
  formatBytes,
  type SessionArtifactSummary,
} from "./types";

type IntegrityResult =
  | { kind: "match" }
  | { kind: "mismatch"; computed: string }
  | { kind: "uncheckable"; reason: string };

/** SHA-256 of a string, hex. Returns null where WebCrypto is unavailable. */
async function sha256Hex(text: string): Promise<string | null> {
  const subtle =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto.subtle : undefined;
  if (!subtle) return null;
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/jsonl" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BodyPanel({
  artifact,
  /**
   * The server's own `digest_verifiable` flag. Both sides derive it from the
   * same rule (`disk_verbatim` + a digest), so they should never disagree —
   * and if they do, this panel says so rather than picking the more
   * reassuring answer.
   */
  serverDigestVerifiable = null,
}: {
  artifact: SessionArtifactSummary;
  serverDigestVerifiable?: boolean | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);

  const claim = digestClaim(artifact.body_source, artifact.content_sha256);
  const agrees = digestClaimAgreesWithServer(claim, serverDigestVerifiable);
  const hasBody =
    artifact.content_sha256 !== null || artifact.body_object_key !== null;
  const redacted = artifact.body_source === "coord_redacted";

  const runExport = async () => {
    setBusy(true);
    setError(null);
    setIntegrity(null);
    try {
      const body = await exportSessionBody(artifact.id);
      const computed = await sha256Hex(body.text);
      // Prefer the head row's digest — it is the value the corpus indexes on;
      // the served header is a courtesy copy of the same thing.
      const expected = artifact.content_sha256 ?? body.servedSha256;
      if (computed === null) {
        setIntegrity({
          kind: "uncheckable",
          reason:
            "WebCrypto is unavailable in this browsing context, so the downloaded bytes were not re-hashed here.",
        });
      } else if (!expected) {
        setIntegrity({
          kind: "uncheckable",
          reason:
            "The archive recorded no digest for this body, so there is nothing to compare the download against.",
        });
      } else if (computed === expected) {
        setIntegrity({ kind: "match" });
      } else {
        setIntegrity({ kind: "mismatch", computed });
      }
      download(
        `${artifact.claude_session_id}${redacted ? ".redacted" : ""}.jsonl`,
        body.text
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "the export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2" data-testid="session-body-panel">
      <h3 className="text-sm font-semibold">Archived body</h3>

      <div className="flex flex-wrap items-center gap-2">
        <DigestBadge
          bodySource={artifact.body_source}
          contentSha256={artifact.content_sha256}
        />
        <SecretFindingsBadge
          count={artifact.secret_finding_count}
          kinds={artifact.secret_finding_kinds}
        />
        <span className="text-xs text-muted-foreground">
          {formatBytes(artifact.byte_count)}
          {artifact.turn_count !== null ? ` · ${artifact.turn_count} turns` : ""}
        </span>
      </div>

      {/* The claim in full, not only as a tooltip — a digest's meaning is not
          a detail a reader should have to hover to discover. */}
      <p
        className="max-w-3xl text-xs text-muted-foreground"
        data-testid="session-digest-detail"
      >
        {claim.detail}
      </p>

      {agrees === false && (
        <p
          className="flex max-w-3xl items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"
          data-testid="session-digest-disagreement"
        >
          <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The server reports this digest as{" "}
          {serverDigestVerifiable ? "verifiable" : "NOT verifiable"}, which
          contradicts what the row&apos;s own <code>body_source</code> says.
          Until that is explained, treat the digest as unverified — the two
          answers cannot both be right.
        </p>
      )}

      {/* The secret-findings signal, stated as what it is. Written here as
          well as on the chip because the misreading it prevents — "this row
          is redacted / restricted" — is a misreading about the BODY. */}
      {artifact.secret_finding_count > 0 && (
        <p className="max-w-3xl text-xs text-muted-foreground">
          The {artifact.secret_finding_count} secret finding
          {artifact.secret_finding_count === 1 ? "" : "s"} recorded on this row
          {artifact.secret_finding_kinds &&
          artifact.secret_finding_kinds.length > 0
            ? ` (${artifact.secret_finding_kinds.join(", ")})`
            : ""}{" "}
          are an <strong>audit signal only</strong>. Nothing is masked and
          nothing is hidden: the body below is exactly as archived, and this
          row is no less visible than any other. Exposure is controlled by
          access, not by mutating bytes.
        </p>
      )}

      {hasBody ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runExport()}
            disabled={busy}
            data-testid="session-export"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {redacted ? "Export redacted copy (JSONL)" : "Export verbatim JSONL"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Downloads the whole body — up to several MB. The transcript above
            is read a page at a time and never fetches this.
          </span>
        </div>
      ) : (
        <p
          className="text-xs text-muted-foreground"
          data-testid="session-export-unavailable"
        >
          Nothing to export: {displayName(artifact)} is a metadata-only row.
          The archive knows the session existed but never received its bytes.
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive" data-testid="session-export-error">
          Export failed: {error}
        </p>
      )}

      {integrity?.kind === "match" && (
        <p
          className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
          data-testid="session-export-integrity"
          data-integrity="match"
        >
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The downloaded bytes hash to the recorded digest — the stored copy is
          intact.
          {redacted
            ? " This still says nothing about the session's original file: these are coord's redacted bytes, and no digest here can be checked against the original."
            : " Because this body is the verbatim file, that digest is also the original file's."}
        </p>
      )}

      {integrity?.kind === "mismatch" && (
        <p
          className="flex items-start gap-1.5 text-xs text-destructive"
          data-testid="session-export-integrity"
          data-integrity="mismatch"
        >
          <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The downloaded bytes hash to{" "}
          <span className="font-mono">{integrity.computed.slice(0, 12)}</span>,
          which does NOT match the digest recorded on this row. The archive and
          its head row disagree — do not treat the download as this session&apos;s
          transcript until that is explained.
        </p>
      )}

      {integrity?.kind === "uncheckable" && (
        <p
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
          data-testid="session-export-integrity"
          data-integrity="uncheckable"
        >
          <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {integrity.reason} The download is unchecked — that is unknown, not
          a pass.
        </p>
      )}
    </section>
  );
}
