const { sendError } = require('../utils/responseHandler');

/**
 * 404 Route Not Found Middleware
 */
const notFoundHandler = (req, res, next) => {
    return sendError(res, `Route not found: ${req.originalUrl}`, 404);
};

/**
 * Global Error Handler Middleware
 */
const globalErrorHandler = (err, req, res, next) => {
    console.error('💥 Unhandled Error:', err);

    // Duplicate/unique constraint error
    if (err.code === 'ER_DUP_ENTRY' || err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === '23505') {
        return sendError(res, 'A record with this unique attribute (e.g. email) already exists.', 409);
    }

    // Foreign key constraint error
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || err.code === '23503') {
        return sendError(res, 'Foreign key constraint violation. Referenced record does not exist or has dependents.', 400);
    }

    // JSON Syntax Error
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return sendError(res, 'Malformed JSON payload provided.', 400);
    }

    // Default Fallback - Hide raw SQL and internal traces from user
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message && process.env.NODE_ENV === 'development'
        ? err.message
        : 'An internal server error occurred. Please try again later.';

    return sendError(res, message, statusCode);
};

module.exports = {
    notFoundHandler,
    globalErrorHandler
};
