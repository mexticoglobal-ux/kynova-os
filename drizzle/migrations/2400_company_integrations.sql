-- Company Integrations Framework (Entrega 15). Owned by src/platform/integrations. One row per company and connector.
-- `credential_ref` is only a reference to a future secret vault entry: no token or secret value is ever stored here.
CREATE TABLE `ci_integrations` (
	`tenant_id` text NOT NULL, `connector` text NOT NULL, `status` text NOT NULL, `config` text DEFAULT '{}' NOT NULL, `credential_ref` text, `last_sync_at` integer,
	`updated_by` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `connector`),
	FOREIGN KEY (`tenant_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`status` IN ('not_configured','pending','connected','error'))
);
--> statement-breakpoint
CREATE TRIGGER ci_integrations_no_delete BEFORE DELETE ON ci_integrations BEGIN SELECT RAISE(ABORT, 'ci_integrations rows cannot be deleted'); END;
