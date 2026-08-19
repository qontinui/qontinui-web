import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/organizations/new/page` — the module the composed cloud
 * build renders at `/organizations/new`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function OrganizationsNewAbsent(): never {
  notFound();
}
