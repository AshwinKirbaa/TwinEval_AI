const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluationController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');
const { validateEvaluation } = require('../middleware/validation');

/**
 * @route   GET /evaluations
 * @desc    Get all evaluation results
 * @access  Public / Private
 */
router.get('/', evaluationController.getEvaluations);

/**
 * @route   GET /evaluations/:id
 * @desc    Get evaluation result by ID
 * @access  Public / Private
 */
router.get('/:id', evaluationController.getEvaluationById);

/**
 * @route   POST /evaluations
 * @desc    Create evaluation result & auto calculate AI score
 * @access  Private (Teacher/Admin)
 */
router.post('/', verifyToken, authorizeRoles('teacher', 'admin'), validateEvaluation, evaluationController.createEvaluation);

/**
 * @route   PUT /evaluations/:id
 * @desc    Update evaluation result
 * @access  Private (Teacher/Admin)
 */
router.put('/:id', verifyToken, authorizeRoles('teacher', 'admin'), evaluationController.updateEvaluation);

/**
 * @route   DELETE /evaluations/:id
 * @desc    Delete evaluation result
 * @access  Private (Teacher/Admin)
 */
router.delete('/:id', verifyToken, authorizeRoles('teacher', 'admin'), evaluationController.deleteEvaluation);

module.exports = router;
