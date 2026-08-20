import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/billing/canceled/page` — the module the composed cloud
 * build renders at `/billing/canceled`. See `docs/composed-cloud-build.md`.
 */
export default function BillingCanceledAbsent(): never {
  notFound();
}
