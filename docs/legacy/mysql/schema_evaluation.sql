-- ========================================================
-- TwinEval AI - Schema Extension for Real AI Paper Evaluation
-- Legacy MySQL file; the original companion schema is `schema.sql` in this same directory. (it extends the same database).
-- ========================================================

USE `twineval_ai`;

-- Students need a roll/register number to match how they identify
-- themselves on an actual answer sheet.
ALTER TABLE `Student`
    ADD COLUMN `roll_no` VARCHAR(50) NULL AFTER `name`,
    ADD COLUMN `user_id` INT NULL AFTER `roll_no`,
    ADD CONSTRAINT `fk_student_user` FOREIGN KEY (`user_id`) REFERENCES `Users` (`user_id`) ON DELETE SET NULL,
    ADD INDEX `idx_student_roll_no` (`roll_no`);

-- 6. QuestionPaper: a paper created by a teacher, either typed manually
-- or OCR'd from an uploaded question-paper file.
DROP TABLE IF EXISTS `QuestionResult`;
DROP TABLE IF EXISTS `Submission`;
DROP TABLE IF EXISTS `AnswerKey`;
DROP TABLE IF EXISTS `Question`;
DROP TABLE IF EXISTS `QuestionPaper`;

CREATE TABLE `QuestionPaper` (
    `paper_id` INT AUTO_INCREMENT PRIMARY KEY,
    `teacher_id` INT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `subject` VARCHAR(150) NOT NULL,
    `topic` VARCHAR(150),
    `pass_percentage` DECIMAL(5,2) NOT NULL DEFAULT 40.00,
    `source_file_path` VARCHAR(500),
    `status` ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_paper_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `Users` (`user_id`) ON DELETE CASCADE,
    INDEX `idx_paper_teacher` (`teacher_id`),
    INDEX `idx_paper_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Question: an individual question within a paper. `ai_question_id`
-- is the id the AI engine assigned (used to correlate its answer-key
-- and evaluation responses back to this row).
CREATE TABLE `Question` (
    `question_id` INT AUTO_INCREMENT PRIMARY KEY,
    `paper_id` INT NOT NULL,
    `ai_question_id` VARCHAR(32) NOT NULL,
    `question_order` INT NOT NULL DEFAULT 0,
    `text` TEXT NOT NULL,
    `topic` VARCHAR(150),
    `max_marks` DECIMAL(6,2) NOT NULL DEFAULT 10.00,
    `group_id` VARCHAR(64) NULL,
    `group_required` INT NULL,
    CONSTRAINT `fk_question_paper` FOREIGN KEY (`paper_id`) REFERENCES `QuestionPaper` (`paper_id`) ON DELETE CASCADE,
    INDEX `idx_question_paper` (`paper_id`),
    UNIQUE INDEX `idx_question_ai_id` (`paper_id`, `ai_question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. AnswerKey: the AI-generated answer key for one Question. Stored
-- as JSON since its structure (keywords/concepts/rubric/etc) mirrors
-- the AI engine's own AnswerKey model exactly -- no need to normalize
-- further for a single-teacher-owned, rarely-queried-by-field blob.
CREATE TABLE `AnswerKey` (
    `answer_key_id` INT AUTO_INCREMENT PRIMARY KEY,
    `question_id` INT NOT NULL UNIQUE,
    `data` JSON NOT NULL,
    `generated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_answerkey_question` FOREIGN KEY (`question_id`) REFERENCES `Question` (`question_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Submission: one student's attempt at one QuestionPaper.
CREATE TABLE `Submission` (
    `submission_id` INT AUTO_INCREMENT PRIMARY KEY,
    `paper_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `answer_file_path` VARCHAR(500),
    `raw_extracted_text` LONGTEXT,
    `total_marks` DECIMAL(6,2),
    `max_marks` DECIMAL(6,2),
    `percentage` DECIMAL(5,2),
    `grade` VARCHAR(5),
    `pass_fail` ENUM('Pass', 'Fail'),
    `overall_report` JSON,
    `status` ENUM('processing', 'evaluated', 'reviewed', 'failed') NOT NULL DEFAULT 'processing',
    `error_message` TEXT NULL,
    `teacher_override_marks` DECIMAL(6,2) NULL,
    `teacher_comments` TEXT,
    `submitted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `evaluated_at` TIMESTAMP NULL,
    CONSTRAINT `fk_submission_paper` FOREIGN KEY (`paper_id`) REFERENCES `QuestionPaper` (`paper_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_submission_student` FOREIGN KEY (`student_id`) REFERENCES `Student` (`student_id`) ON DELETE CASCADE,
    INDEX `idx_submission_paper` (`paper_id`),
    INDEX `idx_submission_student` (`student_id`),
    INDEX `idx_submission_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. QuestionResult: the AI's (and optionally teacher-overridden)
-- per-question evaluation for one Submission. Full result JSON kept
-- verbatim (found/missing concepts, evidence map, feedback, etc) for
-- the results/review UI -- key scalar fields are pulled out into real
-- columns for fast querying/sorting.
CREATE TABLE `QuestionResult` (
    `result_id` INT AUTO_INCREMENT PRIMARY KEY,
    `submission_id` INT NOT NULL,
    `question_id` INT NOT NULL,
    `student_answer` LONGTEXT,
    `marks` DECIMAL(6,2) NOT NULL DEFAULT 0,
    `max_marks` DECIMAL(6,2) NOT NULL,
    `percentage` DECIMAL(5,2),
    `grade` VARCHAR(5),
    `is_off_topic` BOOLEAN DEFAULT FALSE,
    `needs_review` BOOLEAN DEFAULT FALSE,
    `teacher_override_marks` DECIMAL(6,2) NULL,
    `full_result` JSON NOT NULL,
    CONSTRAINT `fk_qresult_submission` FOREIGN KEY (`submission_id`) REFERENCES `Submission` (`submission_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_qresult_question` FOREIGN KEY (`question_id`) REFERENCES `Question` (`question_id`) ON DELETE CASCADE,
    INDEX `idx_qresult_submission` (`submission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
