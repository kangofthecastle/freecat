CREATE TABLE `plan_lesson_offer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_slug` text NOT NULL,
	`offered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_lesson_offer_slug_idx` ON `plan_lesson_offer` (`lesson_slug`);--> statement-breakpoint
CREATE TABLE `plan_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`exam_date` text,
	`daily_budget_minutes` integer DEFAULT 60 NOT NULL,
	`daily_new_target` integer,
	`mastery_goal_pct` integer,
	`finish_buffer_days` integer DEFAULT 0 NOT NULL,
	`questions_start_day` text,
	`questions_finish_buffer_days` integer DEFAULT 0 NOT NULL,
	`new_card_order` text DEFAULT 'deck' NOT NULL,
	`onboarded_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "plan_settings_singleton" CHECK("plan_settings"."id" = 1),
	CONSTRAINT "plan_settings_budget_range" CHECK("plan_settings"."daily_budget_minutes" >= 0 AND "plan_settings"."daily_budget_minutes" <= 720),
	CONSTRAINT "plan_settings_goal_range" CHECK("plan_settings"."mastery_goal_pct" IS NULL OR ("plan_settings"."mastery_goal_pct" >= 0 AND "plan_settings"."mastery_goal_pct" <= 100)),
	CONSTRAINT "plan_settings_new_range" CHECK("plan_settings"."daily_new_target" IS NULL OR ("plan_settings"."daily_new_target" >= 0 AND "plan_settings"."daily_new_target" <= 50)),
	CONSTRAINT "plan_settings_buffers_range" CHECK("plan_settings"."finish_buffer_days" >= 0 AND "plan_settings"."finish_buffer_days" <= 3650 AND "plan_settings"."questions_finish_buffer_days" >= 0 AND "plan_settings"."questions_finish_buffer_days" <= 3650),
	CONSTRAINT "plan_settings_order_enum" CHECK("plan_settings"."new_card_order" IN ('deck','shuffled'))
);
--> statement-breakpoint
CREATE TABLE `plan_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`taxonomy_ref` text,
	`refine` text,
	`target_count` integer NOT NULL,
	`minutes` integer NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "plan_task_kind_enum" CHECK("plan_task"."kind" IN ('flashcards','questions','lesson')),
	CONSTRAINT "plan_task_status_enum" CHECK("plan_task"."status" IN ('pending','started','completed','skipped','expired'))
);
--> statement-breakpoint
CREATE INDEX `plan_task_day_idx` ON `plan_task` (`day`,`sort_order`);--> statement-breakpoint
CREATE INDEX `plan_task_status_idx` ON `plan_task` (`status`,`day`);--> statement-breakpoint
CREATE TABLE `plan_taxonomy_pref` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taxonomy_ref` text NOT NULL,
	`comfort` integer,
	`excluded` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "plan_taxonomy_pref_comfort_range" CHECK("plan_taxonomy_pref"."comfort" IS NULL OR ("plan_taxonomy_pref"."comfort" >= 1 AND "plan_taxonomy_pref"."comfort" <= 5))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_taxonomy_pref_ref_idx` ON `plan_taxonomy_pref` (`taxonomy_ref`);