CREATE TABLE `cortex_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`passwordHash` varchar(256) NOT NULL,
	`displayName` varchar(128),
	`role` enum('admin','member') NOT NULL DEFAULT 'member',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignedIn` timestamp,
	CONSTRAINT `cortex_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `cortex_users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `cortexUserId` int;