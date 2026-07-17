export { SqlSessionRepo } from "./sql-session-repo";

import { SqlSessionRepo } from "./sql-session-repo";
import type { OmaDb } from "@open-managed-agents/db-schema";
import type { Logger } from "../ports";
import { SessionService } from "../service";

export function createSqliteSessionService(
  deps: { db: OmaDb },
  opts?: { logger?: Logger },
): SessionService {
  return new SessionService({ repo: new SqlSessionRepo(deps.db), logger: opts?.logger });
}
