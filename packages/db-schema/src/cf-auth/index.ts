// Core self-host schema (SQLite / better-sqlite3).
//
// Holds Better Auth tables plus Agents, Sessions, Model Cards,
// Environments, Files, Workspace backups, KV entries, and Skills.
// drizzle-kit consumes the node-sqlite barrel for the active migration.

export * from "./auth";
export * from "./agents";
export * from "./sessions";
export * from "./model-cards";
export * from "./environments";
export * from "./files";
export * from "./kv";
