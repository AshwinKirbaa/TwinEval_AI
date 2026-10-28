const { sendError } = require('../utils/responseHandler');
const { allowedOrigins } = require('../config/env');
const UserModel = require('../models/userModel');
const SessionModel = require('../models/sessionModel');
const StudentModel = require('../models/studentModel');
const {
    ACCESS_COOKIE, REFRESH_COOKIE,
    signAccessToken, verifyAccessToken, setAccessCookie
} = require('../utils/authCookies');

/**
 * Authenticate the request from the HttpOnly session cookies.
 *
 *  - A valid, unexpired access JWT whose session is still active is accepted.
 *  - If the access JWT is missing or expired, a valid refresh cookie mints a
 *    new access cookie transparently, so short-lived access tokens do not
 *    interrupt a browsing session.
 *  - Logout, password reset and account disabling revoke the server-side
 *    session, so previously issued JWTs stop working immediately.
 *
 * req.user is rebuilt from the database on every request, so role changes and
 * disabled accounts take effect without waiting for a token to expire.
 */
const verifyToken = async (req, res, next) => {
    try {
        const accessToken = req.cookies && req.cookies[ACCESS_COOKIE];
        const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE];
        let session = null;
        let mintNewAccessToken = false;

        if (accessToken) {
            try {
                const claims = verifyAccessToken(accessToken);
                session = await SessionModel.findActive(claims.sid);
                if (session && session.user_id !== claims.user_id) session = null;
                if (!session) return sendError(res, 'Your session has ended. Please sign in again.', 401);
            } catch (error) {
                if (error.name !== 'TokenExpiredError') {
                    return sendError(res, 'Invalid authentication credentials.', 401);
                }
            }
        }

        if (!session) {
            session = await SessionModel.findActiveByRefreshToken(refreshToken);
            if (!session) {
                return sendError(res, accessToken ? 'Your session has expired. Please sign in again.' : 'Authentication required.', 401);
            }
            mintNewAccessToken = true;
        }

        const user = await UserModel.findAuthContext(session.user_id);
        if (!user || user.account_status !== 'active' || !user.email_verified_at) {
            return sendError(res, 'Your session has ended. Please sign in again.', 401);
        }

        if (mintNewAccessToken) setAccessCookie(res, signAccessToken(user, session.session_id));

        req.user = {
            user_id: user.user_id,
            email: user.email,
            name: user.name,
            role: user.role,
            student_id: user.student_id || null,
            session_id: session.session_id
        };
        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Role Based Authorization Guard Middleware (401 if unauthenticated,
 * 403 if authenticated but lacking the role).
 */
const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return sendError(res, 'User authentication required.', 401);
        }

        if (!allowedRoles.includes(req.user.role)) {
            return sendError(res, 'You do not have permission to perform this action.', 403);
        }

        next();
    };
};

/**
 * Allow teachers/admins, or a student acting on their own student record.
 * `param` names the route parameter holding the student_id.
 */
const requireSelfOrStaff = (param = 'id') => async (req, res, next) => {
    try {
        if (!req.user) return sendError(res, 'User authentication required.', 401);
        if (req.user.role === 'teacher' || req.user.role === 'admin') return next();
        const own = await StudentModel.findByUserId(req.user.user_id);
        if (own && Number(own.student_id) === Number(req.params[param])) return next();
        return sendError(res, 'You do not have permission to view this record.', 403);
    } catch (error) {
        next(error);
    }
};

/**
 * CSRF defence for cookie-authenticated requests, layered on SameSite=Strict
 * cookies: unsafe methods must come from this app's own origin (or an
 * explicitly allowed one). Non-browser clients that send no Origin and no
 * cross-site fetch metadata are unaffected.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfOriginGuard = (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
        let sameHost = false;
        try { sameHost = new URL(origin).host === req.get('host'); } catch (_) { /* invalid origin */ }
        if (sameHost || allowedOrigins().has(origin.replace(/\/$/, ''))) return next();
        return sendError(res, 'Cross-site request blocked.', 403);
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
        return sendError(res, 'Cross-site request blocked.', 403);
    }
    next();
};

module.exports = {
    verifyToken,
    authorizeRoles,
    requireSelfOrStaff,
    csrfOriginGuard
};
