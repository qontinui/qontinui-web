import { redirect } from "next/navigation";

/**
 * `/organizations` has no first-class landing page in the OSS deployment —
 * org-level affordances live on `/settings/account`. This thin route
 * makes the redirect intentional and routes-table-discoverable rather
 * than relying on a 404 fallback. The cloud-control bundle owns
 * `/organizations/[id]/...` and overrides this path when loaded.
 */
export default function OrganizationsIndexPage(): never {
  redirect("/settings/account");
}
