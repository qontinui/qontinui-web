import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/organizations/[id]/members/page` — the module the composed cloud
 * build renders at `/organizations/[id]/members`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function OrganizationMembersAbsent(): never {
  notFound();
}
