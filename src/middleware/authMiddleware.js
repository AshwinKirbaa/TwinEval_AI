const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/responseHandler');
const { COOKIE_NAME, getJwtSecret } = require('../config/authConfig');
const UserModel = require('../models/userModel');
const StudentModel = require('../models/studentModel');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) {
            try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch (_) { return null; }
        }
    }
    return null;
}

/**
 * Cookie-authenticated, state-changing requests must prove they came from our own frontend:
 * a custom header (cannot be set cross-site without CORS approval) and, when the browser sends
 * one, a same-host Origin. SameSite=Lax on the cookie is a second layer.
 */
function passesCsrfCheck(req) {
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.get('x-requested-with') !== 'XMLHttpRequest') return false;
    const origin = req.get('origin');
    if (origin) {
        try {
            if (new URL(origin).host !== req.get('host')) {
                const allowed = String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
                if (!allowed.includes(origin)) return false;
            }
        } catch (_) { return false; }
    }
    return true;
}

/**
 * Verify the session (HttpOnly cookie, or Authorization: Bearer for API clients) and attach the
 * identity as stored in the database. Role and student_id are never taken from the token body
 * or from the client; a deleted user or a token issued before a password change is rejected.
 */
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';
        let token = null;
        let viaCookie = false;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        } else {
            token = readCookie(req, COOKIE_NAME);
            viaCookie = Boolean(token);
        }
        if (!token) {
            return sendError(res, 'Please sign in to continue.', 401);
        }
        if (viaCookie && !passesCsrfCheck(req)) {
            return sendError(res, 'Request blocked for your security. Please reload the page and try again.', 403);
        }

        let decoded;
        try {
            decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return sendError(res, 'Your session has expired. Please sign in again.', 401);
            }
            return sendError(res, 'Your session is not valid. Please sign in again.', 401);
        }

        const user = await UserModel.findAuthById(decoded.user_id);
        if (!user) {
            return sendError(res, 'Your session is not valid. Please sign in again.', 401);
        }
        if (user.password_changed_at && Math.floor(new Date(user.password_changed_at).getTime() / 1000) > decoded.iat) {
            return sendError(res, 'Your password was changed. Please sign in again.', 401);
        }

        let studentId = null;
        if (user.role === 'student') {
            const student = await StudentModel.findByUserId(user.user_id);
            studentId = student ? student.student_id : null;
        }
        req.user = { user_id: user.user_id, email: user.email, name: user.name, role: user.role, student_id: studentId };
        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Role Based Authorization Guard Middleware
 * @param {...string} allowedRoles - List of authorized roles (e.g., 'admin', 'teacher')
 */
const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return sendError(res, 'Please sign in to continue.', 401);
        }
        if (!allowedRoles.includes(req.user.role)) {
            return sendError(res, 'You do not have permission to access this resource.', 403);
        }
        next();
    };
};

module.exports = { verifyToken, authorizeRoles, readCookie };
