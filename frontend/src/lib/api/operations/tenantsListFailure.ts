/**
 * The tenants list's failure message, and its one reader.
 *
 * {@link listTenants} (`./tenants`) writes the message, the layout's tenant
 * provider keeps it as its `error` string, and a page that must tell coord's
 * refusal to list from a failure a reload may clear reads it back. The form
 * and the reader live together here, beside the client and re-exported by it,
 * but in a module of their own: the client module is mocked wholesale by a
 * dozen suites, and a page under any of them must still run the real reader.
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
 * The web maps every coord 403 on `/admin/coord/me` to that token, and coord
 * answers it at its operator-role layer: the account may hold a project
 * membership (a helper, say) but lacks the operator role that reads the list.
 * A reload repeats the refusal, and creating a project is refused at the same
 * layer; the project's admin granting the role is what changes it.
 */
export function isTenantsListUnauthorized(message: string | null): boolean {
  if (message === null) return false;
  const failure = /^GET \S+ failed: (\d{3})(?: \((.*)\))?$/.exec(message);
  return failure?.[1] === "403" && failure[2] === "tenant_not_resolved";
}
