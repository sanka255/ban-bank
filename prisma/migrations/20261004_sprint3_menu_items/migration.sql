-- Sprint 3: Menu & Item Configuration
-- Migrates from the old MenuItem→Menu direct FK to the MenuToItem join table,
-- adds isActive to MenuItem, name to MenuRatePlan,
-- rewires RequestedMenuItem to Menu (not MenuItem), adds guestCount,
-- adds the item FK on RequestedItem, and adds @@unique on MenuRate.

-- DropForeignKey
ALTER TABLE `MenuItem` DROP FOREIGN KEY `MenuItem_menuId_fkey`;

-- DropForeignKey
ALTER TABLE `RequestedMenuItem` DROP FOREIGN KEY `RequestedMenuItem_menuItemId_fkey`;

-- AlterTable
ALTER TABLE `MenuItem` DROP COLUMN `menuId`,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `MenuRatePlan` ADD COLUMN `name` VARCHAR(191) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `RequestedMenuItem` DROP COLUMN `menuItemId`,
    ADD COLUMN `guestCount` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `menuId` INTEGER NOT NULL DEFAULT 0;

-- Remove temporary defaults (they were only needed to satisfy NOT NULL during ALTER)
ALTER TABLE `MenuRatePlan` ALTER COLUMN `name` DROP DEFAULT;
ALTER TABLE `RequestedMenuItem` ALTER COLUMN `guestCount` DROP DEFAULT;
ALTER TABLE `RequestedMenuItem` ALTER COLUMN `menuId` DROP DEFAULT;

-- CreateTable
CREATE TABLE `MenuToItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `menuId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,

    UNIQUE INDEX `MenuToItem_menuId_itemId_key`(`menuId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `MenuRate_ratePlanId_menuId_key` ON `MenuRate`(`ratePlanId`, `menuId`);

-- AddForeignKey
ALTER TABLE `MenuToItem` ADD CONSTRAINT `MenuToItem_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `Menu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuToItem` ADD CONSTRAINT `MenuToItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `MenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedItem` ADD CONSTRAINT `RequestedItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `MenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedMenuItem` ADD CONSTRAINT `RequestedMenuItem_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `Menu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
