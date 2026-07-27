CREATE TABLE `sales_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('Shopee','Lazada') NOT NULL,
	`orderDate` varchar(10) NOT NULL,
	`productName` text NOT NULL,
	`brand` varchar(50) NOT NULL,
	`unitPrice` decimal(12,2) NOT NULL,
	`quantity` int NOT NULL,
	`subtotal` decimal(12,2) NOT NULL,
	`sourceFile` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uploaded_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileUrl` varchar(1024) NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`originalName` varchar(500) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`fileSize` bigint NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`uploadedBy` int NOT NULL,
	`importStatus` enum('pending','importing','imported','failed') NOT NULL DEFAULT 'pending',
	`importError` text,
	`ordersImported` int DEFAULT 0,
	CONSTRAINT `uploaded_files_id` PRIMARY KEY(`id`)
);
