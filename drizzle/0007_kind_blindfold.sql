ALTER TABLE `merged_chunks` ADD `topicId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `merged_chunks` DROP COLUMN `documentId`;