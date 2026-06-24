CREATE TABLE `taxonomy_node` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`parent_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `taxonomy_node`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_node_slug_unique` ON `taxonomy_node` (`slug`);--> statement-breakpoint
CREATE TABLE `topic_aamc_category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`aamc_code` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `taxonomy_node`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_aamc_uq` ON `topic_aamc_category` (`topic_id`,`aamc_code`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_slug` text NOT NULL,
	`completed_at` integer,
	`last_viewed_at` integer NOT NULL,
	`counted_for_reward` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_progress_lesson_slug_unique` ON `lesson_progress` (`lesson_slug`);