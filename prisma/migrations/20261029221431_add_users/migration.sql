-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(16) NOT NULL,
    `discriminator` SMALLINT NOT NULL,
    `email_verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_display_name_discriminator_key`(`display_name`, `discriminator`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Enforce the 4-digit discriminator range (not expressible in schema.prisma).
ALTER TABLE `users` ADD CONSTRAINT `users_discriminator_range` CHECK (`discriminator` BETWEEN 1000 AND 9999);
