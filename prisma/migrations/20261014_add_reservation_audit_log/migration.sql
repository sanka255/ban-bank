-- CreateTable
CREATE TABLE `ReservationAuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `actorId` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `oldStatus` ENUM('tentative', 'guaranteed', 'in_progress', 'completed', 'postponed', 'cancelled') NULL,
    `newStatus` ENUM('tentative', 'guaranteed', 'in_progress', 'completed', 'postponed', 'cancelled') NULL,
    `paymentCategory` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReservationAuditLog`
    ADD CONSTRAINT `ReservationAuditLog_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `BanquetReservation`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
