const { body, param, query, validationResult } = require('express-validator');
const { sendError } = require('../utils/responseHandler');

/**
 * Middleware to check validation results and handle errors
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const firstErrorMsg = errors.array()[0].msg;
        return sendError(res, firstErrorMsg, 400, errors.array());
    }
    next();
};

/**
 * Validation rules for user registration
 */
const validateRegistration = [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').trim().isEmail().withMessage('Valid email address is required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('role').optional().isIn(['admin', 'teacher', 'student']).withMessage('Role must be admin, teacher, or student'),
    validate
];

/**
 * Validation rules for user login
 */
const validateLogin = [
    body('email').trim().isEmail().withMessage('Valid email address is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
    validate
];

/**
 * Validation rules for creating/updating student
 */
const validateStudent = [
    body('name').trim().notEmpty().withMessage('Student name is required'),
    body('email').trim().isEmail().withMessage('Valid student email is required').normalizeEmail(),
    body('department').trim().notEmpty().withMessage('Department is required'),
    body('semester').isInt({ min: 1, max: 8 }).withMessage('Semester must be an integer between 1 and 8'),
    validate
];

/**
 * Validation rules for evaluation data
 */
const validateEvaluation = [
    body('student_id').isInt().withMessage('Valid student_id is required'),
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('marks').isFloat({ min: 0, max: 100 }).withMessage('Marks must be a number between 0 and 100'),
    body('attendance').isFloat({ min: 0, max: 100 }).withMessage('Attendance must be a number between 0 and 100'),
    body('communication').isFloat({ min: 0, max: 100 }).withMessage('Communication score must be a number between 0 and 100'),
    body('problem_solving').isFloat({ min: 0, max: 100 }).withMessage('Problem solving score must be a number between 0 and 100'),
    body('remarks').optional().trim(),
    validate
];

/**
 * Validation rules for AI evaluation request
 */
const validateAIEvaluate = [
    body('marks').isFloat({ min: 0, max: 100 }).withMessage('Marks must be between 0 and 100'),
    body('attendance').isFloat({ min: 0, max: 100 }).withMessage('Attendance must be between 0 and 100'),
    body('communication').isFloat({ min: 0, max: 100 }).withMessage('Communication score must be between 0 and 100'),
    body('problem_solving').isFloat({ min: 0, max: 100 }).withMessage('Problem solving score must be between 0 and 100'),
    validate
];

/**
 * Validation rules for Learning Plan creation
 */
const validateLearningPlan = [
    body('student_id').isInt().withMessage('Valid student_id is required'),
    body('weak_topics').isArray().withMessage('weak_topics must be an array of strings'),
    body('recommended_resources').isArray().withMessage('recommended_resources must be an array of strings'),
    body('practice_tasks').isArray().withMessage('practice_tasks must be an array of strings'),
    body('study_schedule').optional(),
    validate
];

module.exports = {
    validateRegistration,
    validateLogin,
    validateStudent,
    validateEvaluation,
    validateAIEvaluate,
    validateLearningPlan,
    validate
};
