const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const UserModel = require('../models/userModel');
const StudentModel = require('../models/studentModel');
const SessionModel = require('../models/sessionModel');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const {
    sendVerificationEmail, sendPasswordResetEmail, canDeliver
} = require('../services/emailService');
const { loginGuard } = require('../middleware/rateLimiters');
const {
    ACCESS_COOKIE, REFRESH_COOKIE,
    signAccessToken, verifyAccessToken, setAccessCookie, setRefreshCookie, clearAuthCookies
} = require('../utils/authCookies');

const BCRYPT_COST = 12;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
// Compared against when the email is unknown so response time does not reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', BCRYPT_COST);

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';
const GENERIC_RESET_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';
const GENERIC_RESEND_MESSAGE = 'If that account exists and still needs verification, a new verification link has been sent.';

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const isUniqueViolation = error => /UNIQUE constraint failed/i.test(String(error && error.message));

/**
 * Register new user
 * POST /auth/register
 * Only 'student' and 'teacher' can be requested publicly (validated upstream);
 * privileged roles are never accepted. Students also get a linked Student row
 * so their results can be tracked.
 */
const register = async (req, res, next) => {
    let userId = null;
    try {
        const { name, email, password, college = '', department = '', year = '', roll_no, semester } = req.body;
        const resolvedRole = req.body.role === 'teacher' ? 'teacher' : 'student';

        if (await UserModel.findByEmail(email)) {
            return sendError(res, 'An account with this email already exists. Try signing in or resetting your password.', 409);
        }

        if (resolvedRole === 'student') {
            if (!roll_no || !department || !semester) {
                return sendError(res, 'Roll number, department and semester are required for student registration.', 400);
            }
            if (await StudentModel.findByEmail(email)) {
                return sendError(res, 'A student with this email already exists.', 409);
            }
        }

        if (!canDeliver()) {
            return sendError(res, 'Email delivery is not configured on the server, so accounts cannot be verified. Contact the administrator.', 503);
        }

        const verificationToken = newToken();
        const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

        try {
            userId = await UserModel.create({
                name, email, password: hashedPassword, role: resolvedRole, college,
                department: department || '', year,
                verificationTokenHash: sha256(verificationToken),
                verificationExpiresAt: new Date(Date.now() + VERIFY_TTL_MS).toISOString()
            });
            if (resolvedRole === 'student') {
                await StudentModel.create({ name, email, department, semester, roll_no, user_id: userId });
            }
        } catch (error) {
            if (userId) await UserModel.deleteById(userId);
            if (isUniqueViolation(error)) {
                return sendError(res, 'An account with these details already exists.', 409);
            }
            throw error;
        }

        let delivery;
        try {
            delivery = await sendVerificationEmail({ to: email, name, token: verificationToken, request: req });
        } catch (mailError) {
            console.error('Verification email delivery failed:', mailError.message);
            if (resolvedRole === 'student') await StudentModel.deleteByUserId(userId);
            await UserModel.deleteById(userId);
            return sendError(res, 'We could not send the verification email. Check your email address or try again later.', 502);
        }

        const message = delivery.mode === 'console'
            ? 'Account created. Email delivery is not configured in this environment, so no email was sent; the verification link was written to the server console.'
            : 'Account created. Check your email to verify your account before signing in.';
        return sendSuccess(res, message, {
            name, email, role: resolvedRole,
            email_verification_required: true,
            email_sent: delivery.delivered
        }, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * Login user
 * POST /auth/login
 * Sets HttpOnly session cookies; no token is returned in the response body.
 */
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const remember = req.body.remember === true;

        if (loginGuard.isLocked(email)) {
            return sendError(res, 'Too many failed sign-in attempts. Please wait a few minutes or reset your password.', 429);
        }

        const user = await UserModel.findByEmail(email);
        const passwordMatches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
        if (!user || !passwordMatches) {
            loginGuard.recordFailure(email);
            return sendError(res, GENERIC_LOGIN_ERROR, 401);
        }

        // Credentials are correct from here on, so these states can be explained.
        if (user.account_status !== 'active') {
            return sendError(res, 'This account has been disabled. Contact your administrator.', 403);
        }
        if (!user.email_verified_at) {
            return res.status(403).json({
                success: false,
                code: 'EMAIL_NOT_VERIFIED',
                message: 'Please verify your email address before signing in. Check your inbox for the verification link.'
            });
        }

        loginGuard.reset(email);

        const student = user.role === 'student' ? await StudentModel.findByUserId(user.user_id) : null;
        const { sessionId, refreshToken } = await SessionModel.create(user.user_id, {
            remember, userAgent: req.get('user-agent') || ''
        });
        setAccessCookie(res, signAccessToken(user, sessionId));
        setRefreshCookie(res, refreshToken, remember ? SessionModel.ttlMs(true) : null);

        return sendSuccess(res, 'Login successful', {
            user_id: user.user_id,
            student_id: student ? student.student_id : null,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar_url: user.avatar_url || null
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Logout: revokes the server-side session and clears the cookies. Works even
 * when the access token has already expired.
 * POST /auth/logout
 */
const logout = async (req, res, next) => {
    try {
        const cookies = req.cookies || {};
        const sessionIds = new Set();
        try {
            if (cookies[ACCESS_COOKIE]) sessionIds.add(verifyAccessToken(cookies[ACCESS_COOKIE]).sid);
        } catch (error) {
            // Expired/invalid access token: fall back to the refresh token below.
        }
        const bySession = await SessionModel.findActiveByRefreshToken(cookies[REFRESH_COOKIE]);
        if (bySession) sessionIds.add(bySession.session_id);
        for (const id of sessionIds) await SessionModel.revoke(id);

        clearAuthCookies(res);
        return sendSuccess(res, 'Signed out.');
    } catch (error) {
        next(error);
    }
};

/**
 * Get current user profile
 * GET /auth/me
 */
const getProfile = async (req, res, next) => {
    try {
        const user = await UserModel.findById(req.user.user_id);
        if (!user) {
            return sendError(res, 'User profile not found', 404);
        }
        return sendSuccess(res, 'User profile retrieved successfully', { ...user, student_id: req.user.student_id });
    } catch (error) {
        next(error);
    }
};

/**
 * Verify a single-use email token sent at registration.
 * POST /auth/verify-email  { token }
 */
const verifyEmail = async (req, res, next) => {
    try {
        const user = await UserModel.findByVerificationTokenHash(sha256(req.body.token));
        if (!user || !user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now()) {
            return sendError(res, 'That verification link is invalid or has expired.', 400);
        }
        await UserModel.markEmailVerified(user.user_id);
        return sendSuccess(res, 'Email verified successfully. You can now sign in.');
    } catch (error) {
        next(error);
    }
};

/**
 * Send a fresh verification link. Always answers generically.
 * POST /auth/resend-verification  { email }
 */
const resendVerification = async (req, res, next) => {
    try {
        const user = await UserModel.findByEmail(req.body.email);
        if (user && user.account_status === 'active' && !user.email_verified_at && canDeliver()) {
            const token = newToken();
            await UserModel.setVerificationToken(user.user_id, sha256(token), new Date(Date.now() + VERIFY_TTL_MS).toISOString());
            try {
                await sendVerificationEmail({ to: user.email, name: user.name, token, request: req });
            } catch (mailError) {
                console.error('Verification email delivery failed:', mailError.message);
            }
        }
        return sendSuccess(res, GENERIC_RESEND_MESSAGE);
    } catch (error) {
        next(error);
    }
};

/**
 * Start a password reset. Always answers generically.
 * POST /auth/forgot-password  { email }
 */
const forgotPassword = async (req, res, next) => {
    try {
        const user = await UserModel.findByEmail(req.body.email);
        if (user && user.account_status === 'active' && canDeliver()) {
            const token = newToken();
            await UserModel.setResetToken(user.user_id, sha256(token), new Date(Date.now() + RESET_TTL_MS).toISOString());
            try {
                await sendPasswordResetEmail({ to: user.email, name: user.name, token, request: req });
            } catch (mailError) {
                console.error('Password reset email delivery failed:', mailError.message);
            }
        }
        return sendSuccess(res, GENERIC_RESET_MESSAGE);
    } catch (error) {
        next(error);
    }
};

/**
 * Complete a password reset with the emailed single-use token.
 * POST /auth/reset-password  { token, password, confirm_password }
 */
const resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;
        const user = await UserModel.findByResetTokenHash(sha256(token));
        if (!user || !user.reset_expires_at || new Date(user.reset_expires_at).getTime() < Date.now()) {
            return sendError(res, 'That reset link is invalid or has expired. Request a new one.', 400);
        }
        await UserModel.updatePassword(user.user_id, await bcrypt.hash(password, BCRYPT_COST));
        await SessionModel.revokeAllForUser(user.user_id);
        loginGuard.reset(user.email);
        return sendSuccess(res, 'Password updated. Sign in with your new password.');
    } catch (error) {
        next(error);
    }
};

/**
 * Update the authenticated user's editable profile fields.
 * Profile data is stored server-side so it survives navigation, logout,
 * and signing in from another device.
 */
const updateProfile = async (req, res, next) => {
    try {
        const { name, email, college = '', department = '', year = '' } = req.body;
        const normalizedName = String(name || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedName || !normalizedEmail) {
            return sendError(res, 'Name and email are required.', 400);
        }

        const existing = await UserModel.findByEmail(normalizedEmail);
        if (existing && Number(existing.user_id) !== Number(req.user.user_id)) {
            return sendError(res, 'That email address is already in use.', 400);
        }

        const updated = await UserModel.updateProfile(req.user.user_id, {
            name: normalizedName,
            email: normalizedEmail,
            college: String(college || '').trim(),
            department: String(department || '').trim(),
            year: String(year || '').trim(),
        });
        if (!updated) return sendError(res, 'Could not update your profile.', 500);

        if (req.user.role === 'student') {
            await StudentModel.updateByUserId(req.user.user_id, {
                name: normalizedName,
                email: normalizedEmail,
                department: String(department || '').trim() || 'General'
            });
        }

        const profile = await UserModel.findById(req.user.user_id);
        return sendSuccess(res, 'Profile updated successfully', profile);
    } catch (error) {
        next(error);
    }
};

/**
 * Upload/replace the current user's profile photo
 * POST /auth/avatar  (multipart/form-data, field name "avatar")
 *
 * Persists the photo server-side, tied to the authenticated user's own
 * account -- unlike a browser-local cache, this survives logout/login
 * and is available from any device the user signs into.
 */
const updateAvatar = async (req, res, next) => {
    try {
        if (!req.file) {
            return sendError(res, 'No image file was uploaded.', 400);
        }
        const avatarUrl = `/uploads/${req.file.filename}`;
        const updated = await UserModel.updateAvatar(req.user.user_id, avatarUrl);
        if (!updated) {
            return sendError(res, 'Could not update profile photo.', 500);
        }
        return sendSuccess(res, 'Profile photo updated successfully', { avatar_url: avatarUrl });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    register,
    login,
    logout,
    getProfile,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    updateProfile,
    updateAvatar
};
