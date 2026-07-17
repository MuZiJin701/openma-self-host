export { SqlAgentRepo } from "./sql-agent-repo";

import { SqlAgentRepo } from "./sql-agent-repo";
import type { OmaDb } from "@open-managed-agents/db-schema";
import type { Logger } from "../ports";
import { AgentService } from "../service";

export function createSqliteAgentService(
  deps: { db: OmaDb },
  opts?: { logger?: Logger },
): AgentService {
  return new AgentService({ repo: new SqlAgentRepo(deps.db), logger: opts?.logger });
}
