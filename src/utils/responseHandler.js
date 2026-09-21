/**
 * Standardized API Response Utilities
 */

/**
 * Send a success response
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {any} data - Payload data
 * @param {number} statusCode - HTTP Status Code (default 200)
 */
const sendSuccess = (res, message = 'Operation Successful', data = null, statusCode = 200) => {
    const response = {
        success: true,
        message
    };

    if (data !== null) {
        response.data = data;
    }

    return res.status(statusCode).json(response);
};

/**
 * Send an error response
 * @param {Object} res - Express response object
 * @param {string} message - Error description message
 * @param {number} statusCode - HTTP Status Code (default 500)
 * @param {any} errors - Detailed validation errors or metadata
 */
const sendError = (res, message = 'An unexpected error occurred', statusCode = 500, errors = null) => {
    const response = {
        success: false,
        message
    };

    if (errors && process.env.NODE_ENV === 'development') {
        response.errors = errors;
    }

    return res.status(statusCode).json(response);
};

module.exports = {
    sendSuccess,
    sendError
};
