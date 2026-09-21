const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { validateRegistration, validateLogin } = require('../middleware/validation');
const upload = require('../middleware/upload');

/**
 * @route   POST /auth/register
 * @desc    Register a new user (Teacher/Admin)
 * @access  Public
 */
router.post('/register', validateRegistration, authController.register);

/**
 * @route   POST /auth/login
 * @desc    Login user & get JWT token
 * @access  Public
 */
router.post('/login', validateLogin, authController.login);

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
