CREATE TABLE `jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`type` varchar(64) NOT NULL,
	`status` enum('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`totalItems` int NOT NULL DEFAULT 0,
	`processedItems` int NOT NULL DEFAULT 0,
	`attempts` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 3,
	`lastError` mediumtext,
	`params` text,
	`result` mediumtext,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chunks` ADD `projectId` int;--> statement-breakpoint
ALTER TABLE `import_logs` ADD `diffReport` mediumtext;--> statement-breakpoint
-- V0.9: Dedup chunk_topics before adding unique constraint
DELETE ct1 FROM `chunk_topics` ct1 INNER JOIN `chunk_topics` ct2 ON ct1.chunkId = ct2.chunkId AND ct1.topicId = ct2.topicId WHERE ct1.id > ct2.id;--> statement-breakpoint
ALTER TABLE `chunk_topics` ADD CONSTRAINT `chunk_topics_chunk_topic_idx` UNIQUE(`chunkId`,`topicId`);--> statement-breakpoint
CREATE INDEX `jobs_projectId_idx` ON `jobs` (`projectId`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_type_status_idx` ON `jobs` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `chunks_projectId_idx` ON `chunks` (`projectId`);--> statement-breakpoint
-- V0.9: Backfill chunks.projectId from documents (M1: done in migration, not at app startup)
UPDATE `chunks` c INNER JOIN `documents` d ON c.documentId = d.id SET c.projectId = d.projectId WHERE c.projectId IS NULL AND c.documentId IS NOT NULL;--> statement-breakpoint
-- V0.9: Backfill chunks.projectId from conversations
UPDATE `chunks` c INNER JOIN `conversations` cv ON c.conversationId = cv.id SET c.projectId = cv.projectId WHERE c.projectId IS NULL AND c.conversationId IS NOT NULL;