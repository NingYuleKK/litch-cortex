CREATE TABLE `merged_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`projectId` int,
	`content` mediumtext NOT NULL,
	`sourceChunkIds` text NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `merged_chunks_id` PRIMARY KEY(`id`)
);
