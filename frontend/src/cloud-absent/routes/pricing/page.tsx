import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/pricing/page` — the module the composed cloud
 * build renders at `/pricing`. See `docs/composed-cloud-build.md`.
 */
export default function PricingAbsent(): never {
  notFound();
}
