const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

/**
 * @route   GET /analytics/department
 * @desc    Get department-level analytics breakdown
 * @access  Public
 */
router.get('/department', analyticsController.getDepartmentAnalytics);

/**
 * @route   GET /analytics/performance
 * @desc    Get platform overall performance metrics
 * @access  Public
 */
router.get('/performance', analyticsController.getPerformanceMetrics);

/**
 * @route   GET /analytics/department-comparison
 * @desc    Compare metrics across all departments
 * @access  Public
 */
router.get('/department-comparison', analyticsController.getDepartmentComparison);

/**
 * @route   GET /analytics
 * @desc    Get all teacher analytics
 * @access  Public
 */
router.get('/', analyticsController.getAnalytics);

/**
 * @route   GET /analytics/:id
 * @desc    Get specific teacher analytics by ID
 * @access  Public
 */
router.get('/:id', analyticsController.getAnalyticsById);

module.exports = router;
