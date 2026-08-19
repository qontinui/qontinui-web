import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/invitations/accept/page` — the module the composed cloud
 * build renders at `/invitations/accept`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function InvitationAcceptAbsent(): never {
  notFound();
}
