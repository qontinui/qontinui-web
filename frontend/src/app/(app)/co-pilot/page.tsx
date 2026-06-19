import { redirect } from "next/navigation";

/**
 * /co-pilot — retired. The co-pilot surface now renders at the Home route
 * `/prompt-home` (Home IS the co-pilot, matching the runner). This redirect
 * preserves any external bookmarks to the old `/co-pilot` path.
 */
export default function CoPilotRedirectPage() {
  redirect("/prompt-home");
}
