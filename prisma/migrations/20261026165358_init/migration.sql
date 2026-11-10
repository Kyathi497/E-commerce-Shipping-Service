-- CreateTable
CREATE TABLE `ShippingRule` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` ENUM('flat', 'free_over', 'by_zone', 'by_weight') NOT NULL,
    `config` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShippingRule_active_priority_idx`(`active`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PincodeCache` (
    `pincode` CHAR(6) NOT NULL,
    `serviceable` BOOLEAN NOT NULL,
    `codAvailable` BOOLEAN NOT NULL,
    `minDays` INTEGER NULL,
    `maxDays` INTEGER NULL,
    `provider` VARCHAR(32) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`pincode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderToken` (
    `provider` VARCHAR(32) NOT NULL,
    `token` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(64) NOT NULL,
    `target` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `meta` JSON NULL,

    INDEX `AuditLog_target_idx`(`target`),
    INDEX `AuditLog_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Today's shipping charge (flat ₹70 per order), so quotes match the store from day one.
INSERT INTO `ShippingRule` (`id`, `name`, `type`, `config`, `priority`, `active`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'Flat ₹70 per order', 'flat', JSON_OBJECT('amountPaise', 7000), 100, true, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
