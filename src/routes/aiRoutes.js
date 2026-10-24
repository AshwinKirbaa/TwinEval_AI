const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');
const { validateAIEvaluate } = require('../middleware/validation');

/**
 * @route   POST /ai/evaluate
 * @desc    Calculate AI score, grade, strengths, weaknesses, and suggestions
 * @access  Public
 */
router.post('/evaluate', verifyToken, authorizeRoles('teacher', 'admin'), validateAIEvaluate, aiController.evaluateStudent);

/**
 * @route   POST /ai/learning-plan
 * @desc    Generate personalized AI learning plan
 * @access  Public
 */
router.post('/learning-plan', verifyToken, authorizeRoles('teacher', 'admin'), aiController.generateLearningPlan);

module.exports = router;
