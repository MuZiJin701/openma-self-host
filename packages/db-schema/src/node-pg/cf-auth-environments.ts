// Environments (Node-PG local self-host variant).

import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";

export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    config: text("config").notNull(),
    metadata: text("metadata"),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    updated_at: bigint("updated_at", { mode: "number" }),
    archived_at: bigint("archived_at", { mode: "number" }),
  },
  (t) => [index("idx_environments_user").on(t.user_id, t.archived_at)],
);
