const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');

/**
 * @route   GET /analytics/department
 * @desc    Get department-level analytics breakdown
 * @access  Public
 */
router.get('/department', verifyToken, authorizeRoles('teacher', 'admin'), analyticsController.getDepartmentAnalytics);

/**
 * @route   GET /analytics/performance
 * @desc    Get platform overall performance metrics
 * @access  Public
 */
router.get('/performance', verifyToken, authorizeRoles('teacher', 'admin'), analyticsController.getPerformanceMetrics);

/**
 * @route   GET /analytics/department-comparison
 * @desc    Compare metrics across all departments
 * @access  Public
 */
router.get('/department-comparison', verifyToken, authorizeRoles('teacher', 'admin'), analyticsController.getDepartmentComparison);

/**
 * @route   GET /analytics
 * @desc    Get all teacher analytics
 * @access  Public
 */
router.get('/', verifyToken, authorizeRoles('teacher', 'admin'), analyticsController.getAnalytics);

/**
 * @route   GET /analytics/:id
 * @desc    Get specific teacher analytics by ID
 * @access  Public
 */
router.get('/:id', verifyToken, authorizeRoles('teacher', 'admin'), analyticsController.getAnalyticsById);

module.exports = router;
