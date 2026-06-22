CREATE TABLE `coin_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`kind` text,
	`taxonomy_ref` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coin_ledger_reason_created_idx` ON `coin_ledger` (`reason`,`created_at`);--> statement-breakpoint
CREATE TABLE `daily_activity` (
	`day_key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`goal_awarded_at` integer
);
--> statement-breakpoint
CREATE TABLE `eggs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incubation_points` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'incubating' NOT NULL,
	`hatched_pet_id` integer,
	`acquired_at` integer NOT NULL,
	`hatched_at` integer,
	FOREIGN KEY (`hatched_pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `eggs_status_idx` ON `eggs` (`status`);--> statement-breakpoint
CREATE TABLE `gamification_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "gamification_state_singleton" CHECK("gamification_state"."id" = 1),
	CONSTRAINT "gamification_state_coins_nonneg" CHECK("gamification_state"."coins" >= 0)
);
--> statement-breakpoint
CREATE TABLE `owned_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_key` text NOT NULL,
	`acquired_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owned_items_item_idx` ON `owned_items` (`item_key`);--> statement-breakpoint
CREATE TABLE `pets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`species` text NOT NULL,
	`name` text,
	`rarity` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`base_happiness` integer DEFAULT 100 NOT NULL,
	`last_interaction_at` integer NOT NULL,
	`last_treat_at` integer,
	`equipped` text DEFAULT '[]' NOT NULL,
	`hatched_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pets_one_active_idx` ON `pets` (`is_active`) WHERE "pets"."is_active" = 1;