import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/organizations/[id]/settings/page` — the module the composed cloud
 * build renders at `/organizations/[id]/settings`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function OrganizationSettingsAbsent(): never {
  notFound();
}
