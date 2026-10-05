import { createLogger } from "@/lib/logger";

/** The one logger every section of /admin/coord/members writes through. */
export const log = createLogger("CoordMembersPage");
