import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/organizations/[id]/page` — the module the composed cloud
 * build renders at `/organizations/[id]`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function OrganizationDetailAbsent(): never {
  notFound();
}
