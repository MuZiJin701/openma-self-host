CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `version`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_versions_user_agent` ON `agent_versions` (`user_id`,`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`config` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_agents_user` ON `agents` (`user_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `idx_agents_user_created_id` ON `agents` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `session_memory_stores` (
	`session_id` text NOT NULL,
	`store_id` text NOT NULL,
	`access` text DEFAULT 'read_write' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `store_id`)
);
--> statement-breakpoint
CREATE TABLE `session_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_session_resources_session` ON `session_resources` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_session_resources_session_type` ON `session_resources` (`session_id`,`type`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text,
	`environment_id` text,
	`title` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`vault_ids` text,
	`agent_snapshot` text,
	`environment_snapshot` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`archived_at` integer,
	`turn_id` text,
	`turn_started_at` integer,
	`terminated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_created` ON `sessions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_agent` ON `sessions` (`user_id`,`agent_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_environment` ON `sessions` (`user_id`,`environment_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_created_id` ON `sessions` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_running` ON `sessions` (`user_id`,`id`) WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX `idx_sessions_terminated` ON `sessions` (`user_id`,`terminated_at`) WHERE "terminated_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `model_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`model_id` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text,
	`custom_headers` text,
	`api_key_cipher` text NOT NULL,
	`api_key_preview` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`archived_at` integer,
	`model` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_cards_model_id` ON `model_cards` (`user_id`,`model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_cards_default` ON `model_cards` (`user_id`) WHERE "is_default" = 1;--> statement-breakpoint
CREATE INDEX `idx_model_cards_user` ON `model_cards` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_model_cards_user_created_id` ON `model_cards` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`sandbox_worker_name` text,
	`build_error` text,
	`config` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`archived_at` integer,
	`image_strategy` text,
	`image_handle` text
);
--> statement-breakpoint
CREATE INDEX `idx_environments_user` ON `environments` (`user_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `idx_environments_user_created_id` ON `environments` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`scope` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`downloadable` integer DEFAULT 0 NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_files_user_created` ON `files` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_files_user_session_created` ON `files` (`user_id`,`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_files_session` ON `files` (`session_id`);--> statement-breakpoint
CREATE TABLE `workspace_backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`backup_handle` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`source_session_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_backups_scope_recent` ON `workspace_backups` (`user_id`,`environment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_workspace_backups_expires` ON `workspace_backups` (`expires_at`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user` ON `api_keys` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `kv_entries` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer,
	PRIMARY KEY(`user_id`, `key`)
);
