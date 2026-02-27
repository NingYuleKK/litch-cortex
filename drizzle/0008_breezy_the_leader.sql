CREATE TABLE `llm_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL DEFAULT 'builtin',
	`baseUrl` varchar(512),
	`apiKeyEncrypted` text,
	`defaultModel` varchar(256),
	`taskModels` text,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `llm_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` varchar(512),
	`systemPrompt` mediumtext NOT NULL,
	`isPreset` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prompt_templates_id` PRIMARY KEY(`id`)
);
