ALTER TABLE `images` ADD `suggested_category` varchar(150);--> statement-breakpoint
ALTER TABLE `images` ADD `suggested_probabilities` text;--> statement-breakpoint
ALTER TABLE `images` ADD `suggested_model_version` varchar(64);