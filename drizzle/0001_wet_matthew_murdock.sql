CREATE TABLE `chunk_topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chunkId` int NOT NULL,
	`topicId` int NOT NULL,
	`relevanceScore` float NOT NULL DEFAULT 1,
	CONSTRAINT `chunk_topics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`content` text NOT NULL,
	`position` int NOT NULL,
	`tokenCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`filename` varchar(512) NOT NULL,
	`fileUrl` text,
	`rawText` text,
	`uploadTime` timestamp NOT NULL DEFAULT (now()),
	`status` enum('uploading','parsing','extracting','done','error') NOT NULL DEFAULT 'uploading',
	`chunkCount` int NOT NULL DEFAULT 0,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `summaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`topicId` int NOT NULL,
	`summaryText` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `summaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(256) NOT NULL,
	`description` text,
	`weight` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `topics_id` PRIMARY KEY(`id`),
	CONSTRAINT `topics_label_unique` UNIQUE(`label`)
);
