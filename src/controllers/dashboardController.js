const AnalyticsModel = require('../models/analyticsModel');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * GET /dashboard
 * Comprehensive dashboard summary metrics
 */
const getDashboardData = async (req, res, next) => {
    try {
        const dashboardData = await AnalyticsModel.getDashboardOverview();
        return sendSuccess(res, 'Dashboard metrics retrieved successfully', dashboardData);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDashboardData
};
