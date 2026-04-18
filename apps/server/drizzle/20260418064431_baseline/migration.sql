CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY,
	`provider_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`base_url` text NOT NULL,
	`connection_json` text DEFAULT '{}' NOT NULL,
	`credentials_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`last_checked_at` text,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_media_sources_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `provider_accounts` (
	`id` text PRIMARY KEY,
	`provider_id` text NOT NULL,
	`label` text NOT NULL,
	`access_token` text,
	`access_token_hash` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_sessions` (
	`id` text PRIMARY KEY,
	`provider_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`user_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_provider_sessions_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `media_sources_enabled_idx` ON `media_sources` (`enabled`);--> statement-breakpoint
CREATE INDEX `media_sources_provider_id_idx` ON `media_sources` (`provider_id`);--> statement-breakpoint
CREATE INDEX `media_sources_provider_account_id_idx` ON `media_sources` (`provider_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_provider_external_id_idx` ON `media_sources` (`provider_id`,`provider_account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `provider_accounts_provider_id_idx` ON `provider_accounts` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_accounts_provider_access_token_hash_idx` ON `provider_accounts` (`provider_id`,`access_token_hash`) WHERE "provider_accounts"."access_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `provider_sessions_provider_id_idx` ON `provider_sessions` (`provider_id`);--> statement-breakpoint
CREATE INDEX `provider_sessions_provider_account_id_idx` ON `provider_sessions` (`provider_account_id`);--> statement-breakpoint
CREATE INDEX `provider_sessions_expires_at_idx` ON `provider_sessions` (`expires_at`);