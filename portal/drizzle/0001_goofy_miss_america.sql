CREATE TABLE `published_models` (
	`version` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL DEFAULT 'clasificador',
	`run_id` varchar(64) NOT NULL,
	`dvc_release` varchar(255),
	`s3_key` varchar(512) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `published_models_version` PRIMARY KEY(`version`)
);
