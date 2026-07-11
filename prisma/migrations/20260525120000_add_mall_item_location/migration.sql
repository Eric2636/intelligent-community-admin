ALTER TABLE `mall_items`
  ADD COLUMN `locationName` VARCHAR(191) NULL,
  ADD COLUMN `locationAddress` TEXT NULL,
  ADD COLUMN `latitude` DOUBLE NULL,
  ADD COLUMN `longitude` DOUBLE NULL;
