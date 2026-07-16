// Adapter wiring for the dreams-store. CF (D1) and self-host (any SqlClient)
// share the same SqlDreamRepo class.

export { SqlDreamRepo } from "./sql-dream-repo";

import { SqlDreamRepo } from "./sql-dream-repo";
import type { SqlClient } from "@open-managed-agents/sql-client";
import { DreamService, type DreamServiceDeps } from "../service";

type ExistenceDeps = Pick<
  DreamServiceDeps,
  "verifyMemoryStoreExists" | "verifySessionExists"
>;

/** Self-host / SQLite factory. Same shape, different SqlClient. */
export function createSqliteDreamService(
  deps: { client: SqlClient } & ExistenceDeps,
  opts?: { logger?: DreamServiceDeps["logger"] },
): DreamService {
  return new DreamService({
    repo: new SqlDreamRepo(deps.client),
    verifyMemoryStoreExists: deps.verifyMemoryStoreExists,
    verifySessionExists: deps.verifySessionExists,
    logger: opts?.logger,
  });
}
