ALTER TABLE `chunks` MODIFY COLUMN `content` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` MODIFY COLUMN `rawText` mediumtext;--> statement-breakpoint
ALTER TABLE `summaries` MODIFY COLUMN `summaryText` mediumtext NOT NULL;