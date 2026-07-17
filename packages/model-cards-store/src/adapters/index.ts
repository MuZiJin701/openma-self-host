export { SqlModelCardRepo } from "./sql-model-card-repo";

import { SqlModelCardRepo } from "./sql-model-card-repo";
import type { OmaDb } from "@open-managed-agents/db-schema";
import type { Crypto, Logger } from "../ports";
import { ModelCardService } from "../service";

export function createSqliteModelCardService(
  deps: { db: OmaDb },
  opts?: { logger?: Logger; crypto?: Crypto },
): ModelCardService {
  return new ModelCardService({
    repo: new SqlModelCardRepo(deps.db),
    logger: opts?.logger,
    crypto: opts?.crypto,
  });
}
