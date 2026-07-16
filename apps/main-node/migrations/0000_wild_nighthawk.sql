CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "membership_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"tenantId" text,
	"role" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"agent_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"version" bigint NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "agent_versions_agent_id_version_pk" PRIMARY KEY("agent_id","version")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"config" text NOT NULL,
	"version" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint
);
--> statement-breakpoint
CREATE TABLE "session_memory_stores" (
	"session_id" text NOT NULL,
	"store_id" text NOT NULL,
	"access" text DEFAULT 'read_write' NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "session_memory_stores_session_id_store_id_pk" PRIMARY KEY("session_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "session_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"memory_store_id" text,
	"mount_path" text,
	"access" text,
	"instructions" text,
	"url" text,
	"checkout_type" text,
	"checkout_name" text,
	"checkout_sha" text,
	"name" text,
	"value" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text,
	"environment_id" text,
	"status" text NOT NULL,
	"title" text,
	"vault_ids" text,
	"agent_snapshot" text,
	"environment_snapshot" text,
	"metadata" text,
	"turn_id" text,
	"turn_started_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint,
	"terminated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"path" text NOT NULL,
	"content_sha256" text NOT NULL,
	"etag" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_blob_poller_lease" (
	"store_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_seen_ms" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_stores" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint
);
--> statement-breakpoint
CREATE TABLE "memory_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"store_id" text NOT NULL,
	"operation" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"redacted" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_type" text NOT NULL,
	"mcp_server_url" text,
	"provider" text,
	"auth" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint
);
--> statement-breakpoint
CREATE TABLE "model_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text,
	"custom_headers" text,
	"api_key_cipher" text NOT NULL,
	"api_key_preview" text NOT NULL,
	"is_default" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"sandbox_worker_name" text,
	"build_error" text,
	"config" text NOT NULL,
	"metadata" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	"archived_at" bigint,
	"image_strategy" text,
	"image_handle" text
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text,
	"scope" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"downloadable" bigint DEFAULT 0 NOT NULL,
	"r2_key" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"blob_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect_runtime_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "runtime_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"runtime_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"revoked_at" bigint,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "runtime_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "runtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_tenant_id" text NOT NULL,
	"machine_id" text NOT NULL,
	"hostname" text NOT NULL,
	"os" text NOT NULL,
	"agents_json" text DEFAULT '[]' NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"last_heartbeat" bigint,
	"created_at" bigint NOT NULL,
	"local_skills_json" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"suite" text,
	"status" text NOT NULL,
	"started_at" bigint NOT NULL,
	"completed_at" bigint,
	"results" text,
	"score" double precision,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"billed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "kv_entries" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" bigint,
	CONSTRAINT "kv_entries_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "memory_store_tenant" (
	"store_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shard_pool" (
	"binding_name" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tenant_count" bigint DEFAULT 0 NOT NULL,
	"size_bytes" bigint,
	"observed_at" bigint,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "tenant_shard" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"binding_name" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_userId" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_membership_user" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_userId" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_agents_tenant" ON "agents" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_session_resources_session" ON "session_resources" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant_archived" ON "sessions" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_running" ON "sessions" USING btree ("tenant_id","id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_sessions_terminated" ON "sessions" USING btree ("tenant_id","terminated_at") WHERE "terminated_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memories_store_path" ON "memories" USING btree ("store_id","path");--> statement-breakpoint
CREATE INDEX "idx_memory_stores_tenant" ON "memory_stores" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_memory_versions_store" ON "memory_versions" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_memory_versions_memory" ON "memory_versions" USING btree ("memory_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_credentials_vault" ON "credentials" USING btree ("tenant_id","vault_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_credentials_mcp_url_active" ON "credentials" USING btree ("tenant_id","vault_id","mcp_server_url") WHERE "mcp_server_url" IS NOT NULL AND "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_credentials_provider" ON "credentials" USING btree ("tenant_id","vault_id","provider") WHERE "provider" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_vaults_tenant" ON "vaults" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_model_cards_model_id" ON "model_cards" USING btree ("tenant_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_model_cards_default" ON "model_cards" USING btree ("tenant_id") WHERE "is_default" = 1;--> statement-breakpoint
CREATE INDEX "idx_model_cards_tenant" ON "model_cards" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_environments_tenant" ON "environments" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_files_tenant_created" ON "files" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_files_tenant_session_created" ON "files" USING btree ("tenant_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_files_session" ON "files" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_backups_session" ON "workspace_backups" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_workspace_backups_expires" ON "workspace_backups" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_connect_runtime_codes_expires" ON "connect_runtime_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_runtime_tokens_runtime" ON "runtime_tokens" USING btree ("runtime_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_runtimes_user_machine" ON "runtimes" USING btree ("owner_user_id","machine_id");--> statement-breakpoint
CREATE INDEX "idx_runtimes_tenant" ON "runtimes" USING btree ("owner_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_tenant_started" ON "eval_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_tenant_agent_started" ON "eval_runs" USING btree ("tenant_id","agent_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_tenant_environment_started" ON "eval_runs" USING btree ("tenant_id","environment_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_eval_runs_status_active" ON "eval_runs" USING btree ("status","started_at") WHERE "status" = 'pending' OR "status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_usage_events_unbilled" ON "usage_events" USING btree ("tenant_id","id") WHERE "billed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_usage_events_session" ON "usage_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_tenant" ON "api_keys" USING btree ("tenant_id","revoked_at");--> statement-breakpoint
CREATE INDEX "idx_kv_entries_expires" ON "kv_entries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_memory_store_tenant_tenant" ON "memory_store_tenant" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_shard_pool_status" ON "shard_pool" USING btree ("status","tenant_count");--> statement-breakpoint
CREATE INDEX "idx_tenant_shard_binding" ON "tenant_shard" USING btree ("binding_name");
--> statement-breakpoint
CREATE TABLE "dreams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text NOT NULL,
	"input_memory_store_id" text NOT NULL,
	"input_session_ids" text NOT NULL,
	"output_memory_store_id" text,
	"model" text NOT NULL,
	"instructions" text,
	"session_id" text,
	"usage" text NOT NULL,
	"error" text,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"ended_at" bigint,
	"archived_at" bigint
);
--> statement-breakpoint
CREATE INDEX "idx_dreams_tenant_created" ON "dreams" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_dreams_input_store" ON "dreams" USING btree ("input_memory_store_id","status");
--> statement-breakpoint
CREATE INDEX "idx_dreams_output_store" ON "dreams" USING btree ("output_memory_store_id","status");
