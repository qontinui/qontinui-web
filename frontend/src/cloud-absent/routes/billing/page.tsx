import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/billing/page` — the account billing landing
 * page the composed cloud build renders at `/billing`. A self-hosted install
 * has no subscription to manage. See `docs/composed-cloud-build.md`.
 */
export default function BillingAbsent(): never {
  notFound();
}
