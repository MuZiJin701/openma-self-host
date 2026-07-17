export { SqlEnvironmentRepo } from "./sql-environment-repo";

import { SqlEnvironmentRepo } from "./sql-environment-repo";
import type { OmaDb } from "@open-managed-agents/db-schema";
import type { Logger } from "../ports";
import { EnvironmentService } from "../service";

export function createSqliteEnvironmentService(
  deps: { db: OmaDb },
  opts?: { logger?: Logger },
): EnvironmentService {
  return new EnvironmentService({ repo: new SqlEnvironmentRepo(deps.db), logger: opts?.logger });
}
