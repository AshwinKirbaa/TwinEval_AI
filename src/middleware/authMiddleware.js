const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/responseHandler');

/**
 * Verify JWT Authentication Token Middleware
 */
const verifyToken = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || req.headers.Authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 'Access denied. No authentication token provided.', 401);
        }

        const token = authHeader.split(' ')[1];
        const secret = process.env.JWT_SECRET || 'twineval_super_secret_jwt_key_2026_hackathon';

        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return sendError(res, 'Authentication token has expired. Please login again.', 401);
        }
        return sendError(res, 'Invalid authentication token.', 401);
    }
};

/**
 * Role Based Authorization Guard Middleware
 * @param {...string} allowedRoles - List of authorized roles (e.g., 'admin', 'teacher')
 */
const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return sendError(res, 'User authentication required.', 401);
        }

        if (!allowedRoles.includes(req.user.role)) {
            return sendError(res, `Access forbidden. Required role: [${allowedRoles.join(', ')}]`, 403);
        }

        next();
    };
};

module.exports = {
    verifyToken,
    authorizeRoles
};
