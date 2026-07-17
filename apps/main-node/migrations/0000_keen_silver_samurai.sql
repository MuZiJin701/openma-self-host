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
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
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
	"user_id" text NOT NULL,
	"version" bigint NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "agent_versions_agent_id_version_pk" PRIMARY KEY("agent_id","version")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
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
	"user_id" text NOT NULL,
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
CREATE TABLE "model_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
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
	"user_id" text NOT NULL,
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
	"user_id" text NOT NULL,
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
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"backup_handle" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"source_session_id" text
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
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
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" bigint,
	CONSTRAINT "kv_entries_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_userId" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_session_userId" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_agents_user" ON "agents" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_session_resources_session" ON "session_resources" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status","user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_archived" ON "sessions" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_running" ON "sessions" USING btree ("user_id","id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_sessions_terminated" ON "sessions" USING btree ("user_id","terminated_at") WHERE "terminated_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_model_cards_model_id" ON "model_cards" USING btree ("user_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_model_cards_default" ON "model_cards" USING btree ("user_id") WHERE "is_default" = 1;--> statement-breakpoint
CREATE INDEX "idx_model_cards_user" ON "model_cards" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_model_cards_user_created_id" ON "model_cards" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_environments_user" ON "environments" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "idx_files_user_created" ON "files" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_files_user_session_created" ON "files" USING btree ("user_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_files_session" ON "files" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_backups_scope_recent" ON "workspace_backups" USING btree ("user_id","environment_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_workspace_backups_expires" ON "workspace_backups" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_api_keys_user" ON "api_keys" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "idx_kv_entries_expires" ON "kv_entries" USING btree ("expires_at");