const { body, param, query, validationResult } = require('express-validator');
const { sendError } = require('../utils/responseHandler');

/**
 * Middleware to check validation results and handle errors
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const list = errors.array();
        const fields = {};
        list.forEach(item => { if (!fields[item.path]) fields[item.path] = item.msg; });
        return res.status(400).json({ success: false, message: list[0].msg, fields });
    }
    next();
};

/**
 * Consistent email normalization for authentication: trim + lowercase only.
 * (validator's normalizeEmail also rewrites Gmail dots/sub-addresses, which
 * can merge distinct mailboxes and made lookups inconsistent.)
 */
const authEmail = (field = 'email') => body(field)
    .trim()
    .isEmail().withMessage('Enter a valid email address.')
    .isLength({ max: 254 }).withMessage('Email address is too long.')
    .customSanitizer(value => String(value).toLowerCase());

const COMMON_PASSWORDS = new Set([
    'password1234', 'password12345', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'welcome12345', 'administrator1'
]);

/** Shared password policy: 12-72 bytes, at least one letter and one digit. */
const passwordPolicy = (field = 'password') => body(field)
    .isString().withMessage('Password is required.')
    .bail()
    .custom(value => {
        if (value.length < 12) throw new Error('Password must be at least 12 characters long.');
        if (Buffer.byteLength(value, 'utf8') > 72) throw new Error('Password must be at most 72 bytes long.');
        if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) throw new Error('Password must contain at least one letter and one number.');
        if (COMMON_PASSWORDS.has(value.toLowerCase())) throw new Error('That password is too common. Choose a stronger one.');
        return true;
    });

const confirmPasswordMatches = (field = 'password', confirmField = 'confirm_password') => body(confirmField)
    .custom((value, { req }) => value === req.body[field]).withMessage('Password and confirm password do not match.');

/**
 * Validation rules for user registration. Only student and teacher accounts
 * can be created publicly; privileged roles are never accepted here.
 */
const validateRegistration = [
    body('name').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Full name must be between 2 and 100 characters.'),
    authEmail(),
    passwordPolicy(),
    confirmPasswordMatches(),
    body('role').optional().isIn(['teacher', 'student']).withMessage('Role must be student or teacher.'),
    body('college').optional({ values: 'falsy' }).isString().trim().isLength({ max: 150 }).withMessage('College name is too long.'),
    body('department').optional({ values: 'falsy' }).isString().trim().isLength({ max: 150 }).withMessage('Department name is too long.'),
    body('roll_no').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }).withMessage('Roll number is too long.'),
    body('semester').optional({ values: 'falsy' }).isInt({ min: 1, max: 8 }).withMessage('Semester must be between 1 and 8.'),
    validate
];

/**
 * Validation rules for user login
 */
const validateLogin = [
    authEmail(),
    body('password').isString().notEmpty().withMessage('Password is required.').isLength({ max: 1024 }),
    body('remember').optional().isBoolean().withMessage('Invalid remember-me value.').toBoolean(),
    validate
];

const validateEmailOnly = [authEmail(), validate];

const validateTokenBody = [
    body('token').isString().matches(/^[a-f0-9]{64}$/i).withMessage('That link is invalid or has expired.'),
    validate
];

const validatePasswordReset = [
    body('token').isString().matches(/^[a-f0-9]{64}$/i).withMessage('That reset link is invalid or has expired.'),
    passwordPolicy('password'),
    confirmPasswordMatches('password', 'confirm_password'),
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
    validateEmailOnly,
    validateTokenBody,
    validatePasswordReset,
    passwordPolicy,
    validateStudent,
    validateEvaluation,
    validateAIEvaluate,
    validateLearningPlan,
    validate
};
