const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

/**
 * @route   GET /dashboard
 * @desc    Get dashboard metrics, top/lowest performers, department stats, and recent evaluations
 * @access  Public / Private
 */
router.get('/', dashboardController.getDashboardData);

module.exports = router;
