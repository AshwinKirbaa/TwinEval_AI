-- ========================================================
-- TwinEval AI - Database Schema DDL
-- Database Name: twineval_ai
-- ========================================================

CREATE DATABASE IF NOT EXISTS `twineval_ai` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `twineval_ai`;

-- 1. Users Table (Teachers, Admins, Students)
DROP TABLE IF EXISTS `LearningPlan`;
DROP TABLE IF EXISTS `EvaluationResult`;
DROP TABLE IF EXISTS `TeacherAnalytics`;
DROP TABLE IF EXISTS `Student`;
DROP TABLE IF EXISTS `Users`;

CREATE TABLE `Users` (
    `user_id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `password` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'teacher', 'student') NOT NULL DEFAULT 'teacher',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_user_email` (`email`),
    INDEX `idx_user_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Student Table
CREATE TABLE `Student` (
    `student_id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL UNIQUE,
    `department` VARCHAR(100) NOT NULL,
    `semester` INT NOT NULL CHECK (`semester` BETWEEN 1 AND 8),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_student_dept` (`department`),
    INDEX `idx_student_semester` (`semester`),
    INDEX `idx_student_email` (`email`),
    FULLTEXT INDEX `idx_student_search` (`name`, `email`, `department`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. EvaluationResult Table
CREATE TABLE `EvaluationResult` (
    `evaluation_id` INT AUTO_INCREMENT PRIMARY KEY,
    `student_id` INT NOT NULL,
    `subject` VARCHAR(100) NOT NULL,
    `marks` DECIMAL(5,2) NOT NULL CHECK (`marks` BETWEEN 0 AND 100),
    `attendance` DECIMAL(5,2) NOT NULL CHECK (`attendance` BETWEEN 0 AND 100),
    `communication` DECIMAL(5,2) NOT NULL CHECK (`communication` BETWEEN 0 AND 100),
    `problem_solving` DECIMAL(5,2) NOT NULL CHECK (`problem_solving` BETWEEN 0 AND 100),
    `ai_score` DECIMAL(5,2) NOT NULL CHECK (`ai_score` BETWEEN 0 AND 100),
    `remarks` TEXT,
    `evaluated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_eval_student` FOREIGN KEY (`student_id`) REFERENCES `Student` (`student_id`) ON DELETE CASCADE,
    INDEX `idx_eval_student` (`student_id`),
    INDEX `idx_eval_subject` (`subject`),
    INDEX `idx_eval_ai_score` (`ai_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. LearningPlan Table
CREATE TABLE `LearningPlan` (
    `plan_id` INT AUTO_INCREMENT PRIMARY KEY,
    `student_id` INT NOT NULL,
    `weak_topics` JSON NOT NULL,
    `recommended_resources` JSON NOT NULL,
    `practice_tasks` JSON NOT NULL,
    `study_schedule` JSON,
    `generated_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_plan_student` FOREIGN KEY (`student_id`) REFERENCES `Student` (`student_id`) ON DELETE CASCADE,
    INDEX `idx_plan_student` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. TeacherAnalytics Table
CREATE TABLE `TeacherAnalytics` (
    `analytics_id` INT AUTO_INCREMENT PRIMARY KEY,
    `department` VARCHAR(100) NOT NULL,
    `average_score` DECIMAL(5,2) NOT NULL,
    `top_students` JSON,
    `weak_students` JSON,
    `generated_on` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_analytics_dept` (`department`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
