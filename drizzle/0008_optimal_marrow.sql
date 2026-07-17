CREATE TABLE `plan_day_award` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`awarded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_day_award_day_idx` ON `plan_day_award` (`day`);