// Environments table for the local self-host runtime.

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const environments = sqliteTable(
  "environments",
  {
    id: text("id").primaryKey().notNull(),
    user_id: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    config: text("config").notNull(),
    metadata: text("metadata"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at"),
    archived_at: integer("archived_at"),
  },
  (t) => [
    index("idx_environments_user").on(t.user_id, t.archived_at),
    index("idx_environments_user_created_id").on(t.user_id, t.created_at, t.id),
  ],
);
