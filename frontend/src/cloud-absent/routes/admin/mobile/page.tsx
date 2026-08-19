import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/admin/mobile/page` — the module the composed cloud
 * build renders at `/admin/mobile`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function AdminMobileAbsent(): never {
  notFound();
}
