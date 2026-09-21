const express = require('express');
const router = express.Router();
const learningPlanController = require('../controllers/learningPlanController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');
const { validateLearningPlan } = require('../middleware/validation');

/**
 * @route   GET /plans
 * @desc    Get all learning plans
 * @access  Public / Private
 */
router.get('/', learningPlanController.getPlans);

/**
 * @route   GET /plans/:id
 * @desc    Get learning plan by ID
 * @access  Public / Private
 */
router.get('/:id', learningPlanController.getPlanById);

/**
 * @route   POST /plans
 * @desc    Create / generate learning plan for student
 * @access  Private (Teacher/Admin)
 */
router.post('/', verifyToken, authorizeRoles('teacher', 'admin'), validateLearningPlan, learningPlanController.createPlan);

/**
 * @route   PUT /plans/:id
 * @desc    Update learning plan
 * @access  Private (Teacher/Admin)
 */
router.put('/:id', verifyToken, authorizeRoles('teacher', 'admin'), learningPlanController.updatePlan);

/**
 * @route   DELETE /plans/:id
 * @desc    Delete learning plan
 * @access  Private (Teacher/Admin)
 */
router.delete('/:id', verifyToken, authorizeRoles('teacher', 'admin'), learningPlanController.deletePlan);

module.exports = router;
