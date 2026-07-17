export { SqlFileRepo } from "./sql-file-repo";

import { SqlFileRepo } from "./sql-file-repo";
import type { OmaDb } from "@open-managed-agents/db-schema";
import type { Logger } from "../ports";
import { FileService } from "../service";

export function createSqliteFileService(
  deps: { db: OmaDb },
  opts?: { logger?: Logger },
): FileService {
  return new FileService({ repo: new SqlFileRepo(deps.db), logger: opts?.logger });
}
