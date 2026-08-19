import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/billing/canceled` — the module the composed cloud
 * build renders at `/billing/canceled`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function BillingCanceledAbsent(): never {
  notFound();
}
