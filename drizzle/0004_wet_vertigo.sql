CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_set_id` integer NOT NULL,
	`note_id` integer NOT NULL,
	`deck_id` integer NOT NULL,
	`template_ord` integer NOT NULL,
	`render_kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cards_deck_browse_idx` ON `cards` (`deck_id`,`id`);--> statement-breakpoint
CREATE INDEX `cards_deck_set_idx` ON `cards` (`deck_set_id`);--> statement-breakpoint
CREATE TABLE `deck_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_filename` text NOT NULL,
	`source_format` text NOT NULL,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_set_id` integer NOT NULL,
	`anki_deck_id` integer NOT NULL,
	`name` text NOT NULL,
	`parent_deck_id` integer,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decks_deck_set_idx` ON `decks` (`deck_set_id`);--> statement-breakpoint
CREATE INDEX `decks_parent_idx` ON `decks` (`parent_deck_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_set_id` integer NOT NULL,
	`filename` text NOT NULL,
	`hash` text NOT NULL,
	`ext` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_deck_set_filename_idx` ON `media` (`deck_set_id`,`filename`);--> statement-breakpoint
CREATE TABLE `note_type_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_type_id` integer NOT NULL,
	`ord` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`note_type_id`) REFERENCES `note_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_type_fields_nt_ord_idx` ON `note_type_fields` (`note_type_id`,`ord`);--> statement-breakpoint
CREATE TABLE `note_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_set_id` integer NOT NULL,
	`anki_notetype_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`css` text DEFAULT '' NOT NULL,
	`render_kind` text NOT NULL,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_types_deck_set_idx` ON `note_types` (`deck_set_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_set_id` integer NOT NULL,
	`note_type_id` integer NOT NULL,
	`anki_guid` text NOT NULL,
	`fields_json` text NOT NULL,
	`tags` text NOT NULL,
	`sort_field` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`deck_set_id`) REFERENCES `deck_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_type_id`) REFERENCES `note_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_deck_set_idx` ON `notes` (`deck_set_id`);--> statement-breakpoint
CREATE INDEX `notes_note_type_idx` ON `notes` (`note_type_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_type_id` integer NOT NULL,
	`ord` integer NOT NULL,
	`name` text NOT NULL,
	`qfmt` text NOT NULL,
	`afmt` text NOT NULL,
	FOREIGN KEY (`note_type_id`) REFERENCES `note_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `templates_nt_ord_idx` ON `templates` (`note_type_id`,`ord`);