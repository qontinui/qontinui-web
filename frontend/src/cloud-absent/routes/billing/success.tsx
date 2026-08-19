import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/billing/success` — the module the composed cloud
 * build renders at `/billing/success`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function BillingSuccessAbsent(): never {
  notFound();
}
