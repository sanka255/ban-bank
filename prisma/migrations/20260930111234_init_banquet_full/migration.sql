-- CreateTable
CREATE TABLE `BanquetHall` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `maxGuests` INTEGER NULL,
    `isPartitioned` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HallPartition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hallId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'inactive', 'maintenance') NOT NULL DEFAULT 'active',
    `accountNo` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaxRange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `minGuests` INTEGER NOT NULL,
    `maxGuests` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HallRate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partitionId` INTEGER NOT NULL,
    `paxRangeId` INTEGER NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FunctionAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TravelAgent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company` VARCHAR(191) NOT NULL,
    `contactInfo` VARCHAR(191) NULL,
    `vatRegNo` VARCHAR(191) NULL,
    `creditLimit` DECIMAL(10, 2) NULL,
    `creditPeriodDays` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BanquetGuest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `travelAgentId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BanquetReservation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationCode` VARCHAR(191) NOT NULL,
    `guestId` INTEGER NOT NULL,
    `functionAccountId` INTEGER NULL,
    `numberOfGuests` INTEGER NOT NULL,
    `discussedBy` VARCHAR(191) NULL,
    `broughtBy` VARCHAR(191) NULL,
    `status` ENUM('tentative', 'guaranteed', 'in_progress', 'completed', 'cancelled', 'postponed') NOT NULL DEFAULT 'tentative',
    `isComplementary` BOOLEAN NOT NULL DEFAULT false,
    `complementaryReason` VARCHAR(191) NULL,
    `invoiceNo` VARCHAR(191) NULL,
    `createdBy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BanquetReservation_reservationCode_key`(`reservationCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BanquetDateSlot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `partitionId` INTEGER NOT NULL,
    `fromDate` DATE NOT NULL,
    `toDate` DATE NOT NULL,
    `fromTime` TIME NOT NULL,
    `toTime` TIME NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('active', 'cancelled', 'postponed') NOT NULL DEFAULT 'active',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `menuId` INTEGER NULL,
    `charge` DECIMAL(10, 2) NOT NULL,
    `accountNo` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Menu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuRatePlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fromDate` DATE NOT NULL,
    `toDate` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuRate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ratePlanId` INTEGER NOT NULL,
    `menuId` INTEGER NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestedItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dateSlotId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,
    `isComplementary` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestedMenuItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dateSlotId` INTEGER NOT NULL,
    `menuItemId` INTEGER NOT NULL,
    `charge` DECIMAL(10, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuestBillLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `dateSlotId` INTEGER NULL,
    `billNo` VARCHAR(191) NOT NULL,
    `lineType` ENUM('hall_charge', 'item', 'menu', 'package', 'extra') NOT NULL,
    `charge` DECIMAL(15, 2) NOT NULL,
    `taxAmount` DECIMAL(15, 2) NOT NULL,
    `chargeWithTax` DECIMAL(15, 2) NOT NULL,
    `fromPms` BOOLEAN NOT NULL DEFAULT false,
    `insertDate` DATE NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HallDeposit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `paymentMethod` VARCHAR(191) NOT NULL,
    `currencyId` INTEGER NULL,
    `settled` BOOLEAN NOT NULL DEFAULT false,
    `receiptNo` VARCHAR(191) NULL,
    `insertDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `remark` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HallCancellationTier` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `daysMin` INTEGER NOT NULL,
    `daysMax` INTEGER NOT NULL,
    `refundPct` DECIMAL(5, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HallWithdrawal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `dateSlotId` INTEGER NULL,
    `withdrawalDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `refundableAmount` DECIMAL(10, 2) NOT NULL,
    `refundPercentage` DECIMAL(65, 30) NOT NULL,
    `cancellationFee` DECIMAL(10, 2) NOT NULL,
    `fullCharge` DECIMAL(10, 2) NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HallPartition` ADD CONSTRAINT `HallPartition_hallId_fkey` FOREIGN KEY (`hallId`) REFERENCES `BanquetHall`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallRate` ADD CONSTRAINT `HallRate_partitionId_fkey` FOREIGN KEY (`partitionId`) REFERENCES `HallPartition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallRate` ADD CONSTRAINT `HallRate_paxRangeId_fkey` FOREIGN KEY (`paxRangeId`) REFERENCES `PaxRange`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BanquetGuest` ADD CONSTRAINT `BanquetGuest_travelAgentId_fkey` FOREIGN KEY (`travelAgentId`) REFERENCES `TravelAgent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BanquetReservation` ADD CONSTRAINT `BanquetReservation_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `BanquetGuest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BanquetReservation` ADD CONSTRAINT `BanquetReservation_functionAccountId_fkey` FOREIGN KEY (`functionAccountId`) REFERENCES `FunctionAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BanquetDateSlot` ADD CONSTRAINT `BanquetDateSlot_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BanquetDateSlot` ADD CONSTRAINT `BanquetDateSlot_partitionId_fkey` FOREIGN KEY (`partitionId`) REFERENCES `HallPartition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuItem` ADD CONSTRAINT `MenuItem_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `MenuCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuItem` ADD CONSTRAINT `MenuItem_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `Menu`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuRate` ADD CONSTRAINT `MenuRate_ratePlanId_fkey` FOREIGN KEY (`ratePlanId`) REFERENCES `MenuRatePlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuRate` ADD CONSTRAINT `MenuRate_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `Menu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedItem` ADD CONSTRAINT `RequestedItem_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedMenuItem` ADD CONSTRAINT `RequestedMenuItem_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestedMenuItem` ADD CONSTRAINT `RequestedMenuItem_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `MenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuestBillLine` ADD CONSTRAINT `GuestBillLine_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuestBillLine` ADD CONSTRAINT `GuestBillLine_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallDeposit` ADD CONSTRAINT `HallDeposit_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallWithdrawal` ADD CONSTRAINT `HallWithdrawal_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HallWithdrawal` ADD CONSTRAINT `HallWithdrawal_dateSlotId_fkey` FOREIGN KEY (`dateSlotId`) REFERENCES `BanquetDateSlot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
