CREATE TABLE `annotation_queue` (
	`id` varchar(36) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`image_kind` varchar(16) NOT NULL,
	`image_key` varchar(512) NOT NULL,
	`image_sha256` varchar(64),
	`image_content_type` varchar(32),
	`model_version` varchar(32) NOT NULL,
	`suggested_class` varchar(128) NOT NULL,
	`probabilities` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `annotation_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `annotation_queue_status_idx` ON `annotation_queue` (`status`);--> statement-breakpoint
CREATE INDEX `annotation_queue_created_at_idx` ON `annotation_queue` (`created_at`);