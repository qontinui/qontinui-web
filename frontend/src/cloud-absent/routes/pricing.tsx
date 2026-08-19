import { notFound } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/pricing` — the module the composed cloud
 * build renders at `/pricing`. See `frontend/docs/composed-cloud-build.md`.
 */
export default function PricingAbsent(): never {
  notFound();
}
