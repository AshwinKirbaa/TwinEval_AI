const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { validateRegistration, validateLogin, validateForgotPassword, validateResetPassword } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimiter');

const loginLimiter = rateLimit({ key: 'login', windowMs: 15 * 60 * 1000, max: 10 });
const registerLimiter = rateLimit({ key: 'register', windowMs: 60 * 60 * 1000, max: 10 });
const forgotLimiter = rateLimit({ key: 'forgot', windowMs: 15 * 60 * 1000, max: 5 });
const resetLimiter = rateLimit({ key: 'reset', windowMs: 15 * 60 * 1000, max: 10 });
const upload = require('../middleware/upload');

/**
 * @route   POST /auth/register
 * @desc    Register a new user (Teacher/Admin)
 * @access  Public
 */
router.post('/register', registerLimiter, validateRegistration, authController.register);

/**
 * @route   POST /auth/login
 * @desc    Login user & get JWT token
 * @access  Public
 */
router.post('/login', loginLimiter, validateLogin, authController.login);

/**
 * @route   POST /auth/logout
 * @desc    Clear the session cookie
 * @access  Public
 */
router.post('/logout', authController.logout);

/**
 * @route   POST /auth/forgot-password
 * @desc    Email a single-use password reset link (generic response)
 * @access  Public
 */
router.post('/forgot-password', forgotLimiter, validateForgotPassword, authController.forgotPassword);

/**
 * @route   POST /auth/reset-password
 * @desc    Set a new password using a reset token
 * @access  Public
 */
router.post('/reset-password', resetLimiter, validateResetPassword, authController.resetPassword);

/**
 * @route   GET /auth/verify-email?token=...
 * @desc    Activate an account from its one-time email link
 * @access  Public
 */
router.get('/verify-email', authController.verifyEmail);

/**
 * @route   GET /auth/me
 * @desc    Get logged in user profile
 * @access  Private (JWT Protected)
 */
router.get('/me', verifyToken, authController.getProfile);

/**
 * @route   PUT /auth/profile
 * @desc    Persist editable profile fields for the logged-in user
 * @access  Private (JWT Protected)
 */
router.put('/profile', verifyToken, authController.updateProfile);

/**
 * @route   POST /auth/avatar
 * @desc    Upload/replace the logged-in user's profile photo
 * @access  Private (JWT Protected)
 */
router.post('/avatar', verifyToken, upload.single('avatar'), authController.updateAvatar);

module.exports = router;
