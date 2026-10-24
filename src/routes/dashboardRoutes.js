const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');

/**
 * @route   GET /dashboard
 * @desc    Get dashboard metrics, top/lowest performers, department stats, and recent evaluations
 * @access  Public / Private
 */
router.get('/', verifyToken, authorizeRoles('teacher', 'admin'), dashboardController.getDashboardData);

module.exports = router;
