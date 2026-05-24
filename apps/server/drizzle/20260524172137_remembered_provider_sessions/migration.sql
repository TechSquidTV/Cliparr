CREATE TABLE `remembered_provider_sessions` (
	`id` text PRIMARY KEY,
	`provider_account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_remembered_provider_sessions_provider_account_id_provider_accounts_id_fk` FOREIGN KEY (`provider_account_id`) REFERENCES `provider_accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remembered_provider_sessions_token_hash_idx` ON `remembered_provider_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `remembered_provider_sessions_provider_account_id_idx` ON `remembered_provider_sessions` (`provider_account_id`);--> statement-breakpoint
CREATE INDEX `remembered_provider_sessions_expires_at_idx` ON `remembered_provider_sessions` (`expires_at`);
