-- ========================================================
-- Migration: add group_id/group_required to Question
-- Run this INSTEAD of re-running schema_evaluation.sql if you already
-- have data you don't want to lose (schema_evaluation.sql drops and
-- recreates these tables from scratch).
--
-- Fixes: "answer any N of M questions" / "(OR)" alternative sections
-- (e.g. "answer any 2 of these 3 questions") were being silently
-- treated as all-mandatory once persisted, inflating the paper's total
-- marks beyond what the question paper actually specifies.
-- ========================================================

USE `twineval_ai`;

ALTER TABLE `Question`
    ADD COLUMN IF NOT EXISTS `group_id` VARCHAR(64) NULL AFTER `max_marks`,
    ADD COLUMN IF NOT EXISTS `group_required` INT NULL AFTER `group_id`;

ALTER TABLE `Submission`
    ADD COLUMN IF NOT EXISTS `error_message` TEXT NULL AFTER `status`;
