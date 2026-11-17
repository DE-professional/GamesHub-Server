-- CreateTable
CREATE TABLE `price_is_nice_puzzles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `puzzle_date` DATE NOT NULL,
    `steam_app_id` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `short_description` TEXT NOT NULL,
    `price_cents` INTEGER UNSIGNED NOT NULL,
    `price_formatted` VARCHAR(32) NOT NULL,
    `screenshots` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `price_is_nice_puzzles_puzzle_date_key`(`puzzle_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
