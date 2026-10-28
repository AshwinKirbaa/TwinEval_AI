const express = require('express');
const router = express.Router();
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

// Staff only: aggregates every student's data.
router.use(verifyToken, authorizeRoles('teacher', 'admin'));

/**
 * @route   GET /dashboard
 * @desc    Get dashboard metrics, top/lowest performers, department stats, and recent evaluations
 * @access  Public / Private
 */
router.get('/', dashboardController.getDashboardData);

module.exports = router;
