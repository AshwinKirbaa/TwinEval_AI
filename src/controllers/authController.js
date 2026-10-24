const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UserModel = require('../models/userModel');
const StudentModel = require('../models/studentModel');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { sendVerificationEmail, sendPasswordResetEmail, isConfigured: isEmailConfigured } = require('../services/emailService');
const { COOKIE_NAME, getJwtSecret, sessionLifetime, durationToMs, cookieOptions } = require('../config/authConfig');

const BCRYPT_ROUNDS = Math.min(Math.max(Number(process.env.BCRYPT_ROUNDS) || 12, 10), 14);
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const GENERIC_LOGIN_ERROR = 'Incorrect email or password. Please check your details and try again.';

// Used to keep response timing similar whether or not the account exists.
let dummyHashPromise = null;
const getDummyHash = () => (dummyHashPromise ||= bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS));

function issueSession(res, user, studentId, remember) {
    const expiresIn = remember ? sessionLifetime.remember() : sessionLifetime.session();
    const token = jwt.sign(
        { user_id: user.user_id, email: user.email, name: user.name, role: user.role, student_id: studentId },
        getJwtSecret(),
        { expiresIn, algorithm: 'HS256' }
    );
    res.cookie(COOKIE_NAME, token, cookieOptions({ persistent: remember, maxAgeMs: durationToMs(expiresIn) }));
    return token;
}

/**
 * Register new user
 * POST /auth/register
 * For role='student', also expects roll_no, department, semester and
 * creates the linked Student row so their name/roll number/marks can
 * actually be tracked -- not just a bare login account.
 */
const register = async (req, res, next) => {
    try {
        const { name, email, password, role, roll_no, department, semester, college = '', year = '' } = req.body;

        // Check if user already exists
        const existingUser = await UserModel.findByEmail(email);
        if (existingUser) {
            return sendError(res, 'User with this email already exists.', 400);
        }

        // Public sign-up can only create student or teacher accounts; admin accounts
        // are never self-service (prevents role escalation through the API).
        const resolvedRole = role || 'teacher';
        if (!['student', 'teacher'].includes(resolvedRole)) {
            return sendError(res, 'Role must be student or teacher.', 400);
        }

        if (resolvedRole === 'student') {
            if (!roll_no || !department || !semester) {
                return sendError(res, 'roll_no, department, and semester are required for student registration.', 400);
            }
            const existingStudent = await StudentModel.findByEmail(email);
            if (existingStudent) {
                return sendError(res, 'A student with this email already exists.', 400);
            }
        }

        if (!isEmailConfigured()) {
            return sendError(res, 'Your Gmail address is valid, but email delivery is not configured on the server. For Gmail, set SMTP_USER to your Gmail address and SMTP_PASS to a Gmail App Password (not your normal Gmail password).', 503);
        }

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // Hash password
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // Save user
        const userId = await UserModel.create({
            name,
            email,
            password: hashedPassword,
            role: resolvedRole,
            college,
            department: department || '',
            year,
            verificationTokenHash,
            verificationExpiresAt
        });

        let studentId = null;
        if (resolvedRole === 'student') {
            studentId = await StudentModel.create({
                name, email, department, semester, roll_no, user_id: userId
            });
        }

        try {
            await sendVerificationEmail({ to: email, name, token: verificationToken, request: req });
        } catch (mailError) {
            console.error('Verification email delivery failed:', mailError.message);
            if (resolvedRole === 'student') await StudentModel.deleteByUserId(userId);
            await UserModel.deleteById(userId);
            return sendError(res, 'We could not send the verification email. Check your email address or try again later.', 502);
        }

        return sendSuccess(res, 'Account created. Check your email to verify your account before signing in.', {
            user_id: userId,
            student_id: studentId,
            name,
            email,
            role: resolvedRole,
            email_verification_required: true
        }, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * Login user
 * POST /auth/login
 */
const login = async (req, res, next) => {
    try {
        const { email, password, remember } = req.body;
        const rememberMe = remember === true || remember === 'true';

        // Always run a bcrypt comparison so unknown emails and wrong passwords look identical.
        const user = await UserModel.findByEmail(email);
        const isMatch = await bcrypt.compare(String(password), user ? user.password : await getDummyHash());
        if (!user || !isMatch) {
            return sendError(res, GENERIC_LOGIN_ERROR, 401);
        }

        // Only someone who knows the password learns the account is unverified.
        if (!user.email_verified_at) {
            return sendError(res, 'Please verify your email address before signing in. Check your inbox for the verification link.', 403);
        }

        let studentId = null;
        if (user.role === 'student') {
            const student = await StudentModel.findByUserId(user.user_id);
            studentId = student ? student.student_id : null;
        }

        const token = issueSession(res, user, studentId, rememberMe);

        return sendSuccess(res, 'Login successful', {
            user_id: user.user_id,
            student_id: studentId,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar_url: user.avatar_url || null,
            token
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Log out: clears the session cookie.
 * POST /auth/logout
 */
const logout = (req, res) => {
    const { maxAge, ...clearOptions } = cookieOptions({ persistent: false });
    res.clearCookie(COOKIE_NAME, clearOptions);
    return sendSuccess(res, 'Signed out successfully');
};

/**
 * Start password recovery
 * POST /auth/forgot-password
 * Always answers the same way for known and unknown emails.
 */
const forgotPassword = async (req, res, next) => {
    try {
        if (!isEmailConfigured()) {
            return sendError(res, 'Password reset email is not available on this server yet. Please contact your administrator.', 503);
        }
        const { email } = req.body;
        const user = await UserModel.findByEmail(email);
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            await UserModel.createPasswordReset(user.user_id, sha256(token), new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString());
            // Not awaited, so response time does not reveal whether the account exists.
            sendPasswordResetEmail({ to: user.email, name: user.name, token, request: req })
                .catch(err => console.error('Password reset email delivery failed:', err.message));
        }
        return sendSuccess(res, 'If an account exists for that email address, we have sent a link to reset the password. The link is valid for 1 hour.');
    } catch (error) {
        next(error);
    }
};

/**
 * Complete password recovery
 * POST /auth/reset-password
 */
const resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;
        const invalid = () => sendError(res, 'This reset link is invalid or has expired. Please request a new one.', 400);

        const reset = await UserModel.findPasswordReset(sha256(String(token)));
        if (!reset || reset.used_at || new Date(reset.expires_at).getTime() < Date.now()) {
            return invalid();
        }
        // Single use: only the request that flips used_at may continue.
        if (!(await UserModel.consumePasswordReset(reset.reset_id))) {
            return invalid();
        }
        const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await UserModel.updatePassword(reset.user_id, hashed);

        res.clearCookie(COOKIE_NAME, (({ maxAge, ...rest }) => rest)(cookieOptions({ persistent: false })));
        return sendSuccess(res, 'Your password has been updated. You can now sign in with it.');
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

/** Verify a single-use email token sent at registration. */
const verifyEmail = async (req, res, next) => {
    try {
        const rawToken = String(req.query.token || '');
        if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
            return sendError(res, 'That verification link is invalid.', 400);
        }
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const user = await UserModel.findByVerificationTokenHash(tokenHash);
        if (!user || !user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now()) {
            return sendError(res, 'That verification link is invalid or has expired.', 400);
        }
        await UserModel.markEmailVerified(user.user_id);
        return sendSuccess(res, 'Email verified successfully. You can now sign in.', { email: user.email });
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
    forgotPassword,
    resetPassword,
    getProfile,
    verifyEmail,
    updateProfile,
    updateAvatar
};
