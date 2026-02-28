CREATE TABLE `chunk_embeddings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chunkId` int NOT NULL,
	`embedding` mediumtext NOT NULL,
	`model` varchar(256) NOT NULL,
	`dimensions` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chunk_embeddings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `embedding_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(64) NOT NULL DEFAULT 'openai',
	`baseUrl` varchar(512),
	`apiKeyEncrypted` text,
	`model` varchar(256) NOT NULL DEFAULT 'text-embedding-3-small',
	`dimensions` int NOT NULL DEFAULT 1536,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `embedding_config_id` PRIMARY KEY(`id`)
);
