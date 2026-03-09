CREATE TABLE `conversation_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`externalMessageId` varchar(128) NOT NULL,
	`role` varchar(32) NOT NULL,
	`content` mediumtext NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`position` int NOT NULL,
	`modelSlug` varchar(128),
	`createTime` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `convmsg_ext_idx` UNIQUE(`conversationId`,`externalMessageId`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`cortexUserId` int NOT NULL,
	`externalId` varchar(128) NOT NULL,
	`title` varchar(512),
	`source` varchar(32) NOT NULL DEFAULT 'chatgpt',
	`model` varchar(128),
	`messageCount` int NOT NULL DEFAULT 0,
	`createTime` timestamp,
	`updateTime` timestamp,
	`status` enum('importing','done','error') NOT NULL DEFAULT 'importing',
	`rawMetadata` text,
	`importLogId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversations_project_external_idx` UNIQUE(`projectId`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `import_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cortexUserId` int,
	`projectId` int,
	`filename` varchar(512) NOT NULL,
	`fileSize` bigint,
	`conversationsTotal` int NOT NULL DEFAULT 0,
	`conversationsImported` int NOT NULL DEFAULT 0,
	`conversationsSkipped` int NOT NULL DEFAULT 0,
	`conversationsUpdated` int NOT NULL DEFAULT 0,
	`messagesTotal` int NOT NULL DEFAULT 0,
	`chunksCreated` int NOT NULL DEFAULT 0,
	`chunksSkipped` int NOT NULL DEFAULT 0,
	`conflicts` text,
	`errors` text,
	`status` enum('running','completed','failed','cancelled') NOT NULL DEFAULT 'running',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chunks` MODIFY COLUMN `documentId` int;--> statement-breakpoint
ALTER TABLE `chunks` ADD `conversationId` int;--> statement-breakpoint
ALTER TABLE `chunks` ADD `stableId` varchar(512);--> statement-breakpoint
ALTER TABLE `chunks` ADD CONSTRAINT `chunks_stableId_idx` UNIQUE(`stableId`);--> statement-breakpoint
CREATE INDEX `convmsg_conv_idx` ON `conversation_messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `conversations_projectId_idx` ON `conversations` (`projectId`);--> statement-breakpoint
CREATE INDEX `importlogs_project_idx` ON `import_logs` (`projectId`);--> statement-breakpoint
CREATE INDEX `chunks_conversationId_idx` ON `chunks` (`conversationId`);