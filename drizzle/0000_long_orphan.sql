CREATE TABLE `profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text DEFAULT 'Student' NOT NULL,
	`created_at` integer NOT NULL
);
