CREATE TABLE `training_jobs` (
	`id` varchar(36) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'queued',
	`release_tag` varchar(255) NOT NULL,
	`params` json NOT NULL,
	`run_id` varchar(64),
	`error` varchar(2048),
	`logs` json NOT NULL DEFAULT ('[]'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `training_jobs_id` PRIMARY KEY(`id`)
);
