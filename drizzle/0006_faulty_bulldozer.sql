CREATE TABLE `card_scheduling` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`deck_set_id` integer NOT NULL,
	`deck_id` integer NOT NULL,
	`state` integer NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`last_review_at` integer,
	`introduced_day` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_scheduling_card_id_unique` ON `card_scheduling` (`card_id`);--> statement-breakpoint
CREATE INDEX `card_scheduling_deck_due_idx` ON `card_scheduling` (`deck_id`,`state`,`due`);--> statement-breakpoint
CREATE INDEX `card_scheduling_deck_set_idx` ON `card_scheduling` (`deck_set_id`);--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`deck_set_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`state_before` integer NOT NULL,
	`due_after` integer NOT NULL,
	`stability_after` real NOT NULL,
	`difficulty_after` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_log_card_idx` ON `review_log` (`card_id`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `review_log_deck_set_idx` ON `review_log` (`deck_set_id`);