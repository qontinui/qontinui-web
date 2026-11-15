/**
 * The tenants list's failure message, and its one reader.
 *
 * {@link listTenants} (`./tenants`) writes the message, the layout's tenant
 * provider keeps it as its `error` string, and a page that must tell coord's
 * refusal to list from a failure a reload may clear reads it back. The form
 * and the reader live together here, beside the client but in a module of
 * their own: ten suites mock the client module wholesale, and a page under
 * any of them must still run the real reader. Import the reader from here,
 * never through `./tenants`.
 * A page-level suite drives the real client against this reader
 * (`PageWriteGuardListRefusal.test.tsx`), so a change to the form that the
 * reader does not follow fails there.
 *
 * The form: `GET <url> failed: <status>`, then ` (<reason>)` when the
 * backend's body named one.
 */

/** The message a refused tenants list throws with. */
export function tenantsListFailureMessage(
  url: string,
  status: number,
  reason: string | null
): string {
  return `GET ${url} failed: ${status}${reason ? ` (${reason})` : ""}`;
}

/**
 * Whether a tenants-list failure is coord's refusal to list the caller's
 * projects: a 403 carrying `tenant_not_resolved`, read from `message` in the
 * form {@link tenantsListFailureMessage} writes. Gated on the status the
 * message carries, as a refusal code means nothing under another status.
 *
 * The token has more than one cause on this route, and the web keeps none of
 * coord's body to tell them apart: it maps every coord 403 on
 * `/admin/coord/me` to the token — coord's `insufficient role`, or its
 * `operator_required` for a role held only outside the project `/me` was
 * scoped to — and raises the same 403 itself for an empty membership. The
 * usual cause is an account without the operator role in its home project.
 * A reload repeats the refusal whichever it is.
 */
export function isTenantsListUnauthorized(message: string | null): boolean {
  if (message === null) return false;
  const failure = /^GET \S+ failed: (\d{3})(?: \((.*)\))?$/.exec(message);
  return failure?.[1] === "403" && failure[2] === "tenant_not_resolved";
}
