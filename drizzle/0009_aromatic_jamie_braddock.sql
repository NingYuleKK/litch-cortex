CREATE TABLE `topic_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`topicId` int NOT NULL,
	`projectId` int,
	`title` varchar(256),
	`messages` mediumtext NOT NULL,
	`promptTemplateId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `topic_conversations_id` PRIMARY KEY(`id`)
);
