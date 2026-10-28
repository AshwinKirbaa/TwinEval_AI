const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const {
    validateRegistration, validateLogin, validateEmailOnly, validateTokenBody, validatePasswordReset
} = require('../middleware/validation');
const {
    loginLimiter, registerLimiter, emailActionLimiter, resetSubmitLimiter
} = require('../middleware/rateLimiters');
const upload = require('../middleware/upload');

/**
 * @route   POST /auth/register
 * @desc    Register a new student or teacher account (never privileged roles)
 * @access  Public (rate limited)
 */
router.post('/register', registerLimiter, validateRegistration, authController.register);

/**
 * @route   POST /auth/login
 * @desc    Sign in; sets HttpOnly session cookies
 * @access  Public (rate limited, per-account lockout)
 */
router.post('/login', loginLimiter, validateLogin, authController.login);

/**
 * @route   POST /auth/logout
 * @desc    Revoke the current session and clear cookies
 * @access  Public (idempotent)
 */
router.post('/logout', authController.logout);

/**
 * @route   POST /auth/verify-email  { token }
 * @desc    Activate an account from its one-time email token
 * @access  Public
 */
router.post('/verify-email', resetSubmitLimiter, validateTokenBody, authController.verifyEmail);

/**
 * @route   POST /auth/resend-verification  { email }
 * @desc    Send a new verification link (generic response)
 * @access  Public (rate limited)
 */
router.post('/resend-verification', emailActionLimiter, validateEmailOnly, authController.resendVerification);

/**
 * @route   POST /auth/forgot-password  { email }
 * @desc    Email a single-use reset link (generic response)
 * @access  Public (rate limited)
 */
router.post('/forgot-password', emailActionLimiter, validateEmailOnly, authController.forgotPassword);

/**
 * @route   POST /auth/reset-password  { token, password, confirm_password }
 * @desc    Set a new password using the emailed token; revokes all sessions
 * @access  Public (rate limited)
 */
router.post('/reset-password', resetSubmitLimiter, validatePasswordReset, authController.resetPassword);

/**
 * @route   GET /auth/me
 * @desc    Get logged in user profile
 * @access  Private
 */
router.get('/me', verifyToken, authController.getProfile);

/**
 * @route   PUT /auth/profile
 * @desc    Persist editable profile fields for the logged-in user
 * @access  Private
 */
router.put('/profile', verifyToken, authController.updateProfile);

/**
 * @route   POST /auth/avatar
 * @desc    Upload/replace the logged-in user's profile photo
 * @access  Private
 */
router.post('/avatar', verifyToken, upload.single('avatar'), authController.updateAvatar);

module.exports = router;
