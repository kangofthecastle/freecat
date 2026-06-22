CREATE TABLE `taxonomy_node` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`parent_id` text
);
