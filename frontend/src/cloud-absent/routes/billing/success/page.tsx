import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/billing/success/page` — the module the composed cloud
 * build renders at `/billing/success`. See `docs/composed-cloud-build.md`.
 */
export default function BillingSuccessAbsent(): never {
  notFound();
}
