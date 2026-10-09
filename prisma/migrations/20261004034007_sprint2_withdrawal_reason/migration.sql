/*
  Warnings:

  - You are about to alter the column `refundPercentage` on the `HallWithdrawal` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(5,2)`.

*/
-- AlterTable
ALTER TABLE `HallWithdrawal` ADD COLUMN `reason` VARCHAR(191) NULL,
    MODIFY `refundPercentage` DECIMAL(5, 2) NOT NULL;
