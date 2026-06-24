CREATE TABLE `qbank_attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`question_id` text NOT NULL,
	`passage_id` text,
	`topic` text NOT NULL,
	`discipline` text NOT NULL,
	`section` text NOT NULL,
	`chosen` text NOT NULL,
	`is_correct` integer NOT NULL,
	`time_ms` integer,
	`answered_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `qbank_session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `qbank_attempt_session_idx` ON `qbank_attempt` (`session_id`);--> statement-breakpoint
CREATE INDEX `qbank_attempt_question_idx` ON `qbank_attempt` (`question_id`);--> statement-breakpoint
CREATE INDEX `qbank_attempt_section_idx` ON `qbank_attempt` (`section`);--> statement-breakpoint
CREATE INDEX `qbank_attempt_topic_idx` ON `qbank_attempt` (`topic`);--> statement-breakpoint
CREATE INDEX `qbank_attempt_discipline_idx` ON `qbank_attempt` (`discipline`);--> statement-breakpoint
CREATE TABLE `qbank_flag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qbank_flag_question_idx` ON `qbank_flag` (`question_id`);--> statement-breakpoint
CREATE TABLE `qbank_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text DEFAULT 'tutor' NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_code` text,
	`refine` text DEFAULT 'all' NOT NULL,
	`requested_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
DROP TABLE `topic_aamc_category`;