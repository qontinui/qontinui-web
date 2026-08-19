import { redirect } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/organizations/page` — the module the
 * composed cloud build renders at `/organizations`.
 *
 * This is one of the two stubs that does NOT call `notFound()`. OSS has
 * always served `/organizations` as a redirect to `/settings/account`, where
 * the self-hosted org affordances actually live, so the stub keeps that
 * behaviour byte-for-byte; the redirect simply moved out of
 * `src/app/(app)/organizations/page.tsx` when that file became a `@cloud`
 * re-export. See `frontend/docs/composed-cloud-build.md`.
 */
export default function OrganizationsIndexAbsent(): never {
  redirect("/settings/account");
}
