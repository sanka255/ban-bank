-- AlterTable
ALTER TABLE `BanquetReservation` ADD COLUMN `checkedInAt` DATETIME(3) NULL,
    ADD COLUMN `checkedInBy` INTEGER NULL,
    ADD COLUMN `checkedOutAt` DATETIME(3) NULL,
    ADD COLUMN `checkedOutBy` INTEGER NULL;

-- AlterTable
ALTER TABLE `RequestedMenuItem` ADD COLUMN `childRate` DECIMAL(10, 2) NULL,
    ADD COLUMN `guestCountAdult` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `guestCountChild` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `HallChangeLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `dateSlotId` INTEGER NOT NULL,
    `oldPartitionId` INTEGER NOT NULL,
    `newPartitionId` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `changedBy` INTEGER NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExtraCharge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dateSlotId` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,
    `isComplementary` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservationDiscount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `discountType` VARCHAR(191) NOT NULL,
    `value` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `authorizedBy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BanquetEventOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `operationsNotes` TEXT NULL,
    `kitchenNotes` TEXT NULL,
    `housekeepingNotes` TEXT NULL,
    `frontOfficeNotes` TEXT NULL,
    `engineeringNotes` TEXT NULL,
    `chiefStewardNotes` TEXT NULL,
    `securityNotes` TEXT NULL,
    `specialInstructions` TEXT NULL,
    `roomSetupDetails` TEXT NULL,
    `updatedBy` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BanquetEventOrder_reservationId_key`(`reservationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventPackage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `isPerHead` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackageItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `packageId` INTEGER NOT NULL,
    `itemId` INTEGER NULL,
    `menuId` INTEGER NULL,
    `customName` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestedPackage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dateSlotId` INTEGER NOT NULL,
    `packageId` INTEGER NOT NULL,
    `guestCount` INTEGER NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,
    `isComplementary` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HallChangeLog` ADD CONSTRAINT `HallChangeLog_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallChangeLog` ADD CONSTRAINT `HallChangeLog_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallChangeLog` ADD CONSTRAINT `HallChangeLog_oldPartitionId_fkey` FOREIGN KEY (`oldPartitionId`) REFERENCES `HallPartition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallChangeLog` ADD CONSTRAINT `HallChangeLog_newPartitionId_fkey` FOREIGN KEY (`newPartitionId`) REFERENCES `HallPartition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExtraCharge` ADD CONSTRAINT `ExtraCharge_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservationDiscount` ADD CONSTRAINT `ReservationDiscount_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BanquetEventOrder` ADD CONSTRAINT `BanquetEventOrder_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackageItem` ADD CONSTRAINT `PackageItem_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `EventPackage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackageItem` ADD CONSTRAINT `PackageItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `MenuItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackageItem` ADD CONSTRAINT `PackageItem_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `Menu`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedPackage` ADD CONSTRAINT `RequestedPackage_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedPackage` ADD CONSTRAINT `RequestedPackage_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `EventPackage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
