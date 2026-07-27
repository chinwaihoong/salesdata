ALTER TABLE `sales_orders` MODIFY COLUMN `orderDate` date NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_orders` ADD `orderId` varchar(64);--> statement-breakpoint
ALTER TABLE `uploaded_files` ADD `fileHash` varchar(64);--> statement-breakpoint
CREATE INDEX `idx_sales_orderDate` ON `sales_orders` (`orderDate`);--> statement-breakpoint
CREATE INDEX `idx_sales_shop_platform_date` ON `sales_orders` (`shop`,`platform`,`orderDate`);--> statement-breakpoint
CREATE INDEX `idx_sales_brand` ON `sales_orders` (`brand`);--> statement-breakpoint
CREATE INDEX `idx_sales_orderId` ON `sales_orders` (`orderId`);