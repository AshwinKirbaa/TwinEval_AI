const AnalyticsModel = require('../models/analyticsModel');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * GET /analytics
 * Teacher analytics overview
 */
const getAnalytics = async (req, res, next) => {
    try {
        const analytics = await AnalyticsModel.getAllTeacherAnalytics();
        return sendSuccess(res, 'Teacher analytics retrieved successfully', analytics);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /analytics/:id
 * Get single analytics record
 */
const getAnalyticsById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const record = await AnalyticsModel.getTeacherAnalyticsById(id);

        if (!record) {
            return sendError(res, 'Analytics record not found', 404);
        }

        return sendSuccess(res, 'Analytics record retrieved successfully', record);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /analytics/department
 * Department-level analytics breakdown
 */
const getDepartmentAnalytics = async (req, res, next) => {
    try {
        const departmentData = await AnalyticsModel.getDepartmentBreakdown();
        return sendSuccess(res, 'Department analytics retrieved successfully', departmentData);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /analytics/performance
 * Platform overall performance metrics
 */
const getPerformanceMetrics = async (req, res, next) => {
    try {
        const performance = await AnalyticsModel.getPerformanceMetrics();
        return sendSuccess(res, 'Performance metrics retrieved successfully', performance);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /analytics/department-comparison
 * Department comparison metrics
 */
const getDepartmentComparison = async (req, res, next) => {
    try {
        const comparison = await AnalyticsModel.getDepartmentComparison();
        return sendSuccess(res, 'Department comparison analytics retrieved successfully', comparison);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAnalytics,
    getAnalyticsById,
    getDepartmentAnalytics,
    getPerformanceMetrics,
    getDepartmentComparison
};
