const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const UserModel = require('../models/userModel');
const StudentModel = require('../models/studentModel');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { sendVerificationEmail, isConfigured: isEmailConfigured } = require('../services/emailService');

function isGmailAddress(email) {
    return /^[^\s@]+@gmail\.com$/i.test(String(email || '').trim());
}

function createSessionToken(user, studentId = null) {
    return jwt.sign(
        { user_id: user.user_id, email: user.email, name: user.name, role: user.role, student_id: studentId },
        process.env.JWT_SECRET || 'twineval_super_secret_jwt_key_2026_hackathon',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
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

        // Syntax validation happens in middleware; keep this defense here as
        // well so registration can never be opened to unverified domains if
        // the controller is reused from another route later.
        if (!isGmailAddress(email)) {
            return sendError(res, 'A Gmail address ending in @gmail.com is required.', 400);
        }

        // Check if user already exists
        const existingUser = await UserModel.findByEmail(email);
        if (existingUser) {
            return sendError(res, 'User with this email already exists.', 400);
        }

        const resolvedRole = role || 'teacher';

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
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

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
        const { email, password } = req.body;

        if (!isGmailAddress(email)) {
            return sendError(res, 'A Gmail address ending in @gmail.com is required.', 400);
        }

        // Find user by email
        const user = await UserModel.findByEmail(email);
        if (!user) {
            return sendError(res, 'Invalid credentials. User not found.', 401);
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return sendError(res, 'Invalid credentials. Password incorrect.', 401);
        }

        // A correctly formatted Gmail address is not proof that the inbox
        // exists or belongs to this user. Only the one-time link sent to that
        // inbox establishes ownership.
        if (!user.email_verified_at) {
            return sendError(res, 'Please verify your Gmail address before signing in. Check your inbox for the verification link.', 403);
        }

        let studentId = null;
        if (user.role === 'student') {
            const student = await StudentModel.findByUserId(user.user_id);
            studentId = student ? student.student_id : null;
        }

        // Generate JWT Token
        const token = createSessionToken(user, studentId);

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

/** Public configuration used only to render Google's official button. */
const getGoogleConfig = (req, res) => {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    return sendSuccess(res, 'Google Sign-In configuration', {
        enabled: Boolean(clientId),
        client_id: clientId
    });
};

/** Verify a Google Identity Services ID token and create a TwinEval session. */
const googleLogin = async (req, res, next) => {
    try {
        const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
        if (!clientId) return sendError(res, 'Google Sign-In is not configured on this server.', 503);

        const credential = String(req.body.credential || '');
        if (!credential) return sendError(res, 'Google did not provide a sign-in credential.', 400);

        let ticket;
        try {
            ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
        } catch (verificationError) {
            return sendError(res, 'Google Sign-In expired or was invalid. Please try again.', 401);
        }
        const profile = ticket.getPayload();
        const email = String(profile?.email || '').trim().toLowerCase();
        const subject = String(profile?.sub || '');
        if (!subject || !profile?.email_verified || !isGmailAddress(email)) {
            return sendError(res, 'Use a verified @gmail.com Google account.', 403);
        }

        let user = await UserModel.findByGoogleSubject(subject);
        if (!user) {
            user = await UserModel.findByEmail(email);
            if (!user) {
                return res.status(409).json({
                    success: false,
                    code: 'REGISTRATION_REQUIRED',
                    message: 'No TwinEval account uses this Gmail address. Create your account first, then continue with Google.'
                });
            }
            if (user.google_subject && user.google_subject !== subject) {
                return sendError(res, 'This Gmail address is already linked to another Google identity.', 409);
            }
            await UserModel.linkGoogleIdentity(user.user_id, subject);
            user = await UserModel.findByGoogleSubject(subject);
        }

        let studentId = null;
        if (user.role === 'student') {
            const student = await StudentModel.findByUserId(user.user_id);
            if (!student) return sendError(res, 'Complete your student profile before using Google Sign-In.', 409);
            studentId = student.student_id;
        }

        const token = createSessionToken(user, studentId);
        return sendSuccess(res, 'Google sign-in successful', {
            user_id: user.user_id,
            student_id: studentId,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar_url: user.avatar_url || profile.picture || null,
            token
        });
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
        return sendSuccess(res, 'User profile retrieved successfully', user);
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
        const { persistUpload } = require('../services/storageService');
        const avatarUrl = await persistUpload(req.file, 'avatars');
        const updated = await UserModel.updateAvatar(req.user.user_id, avatarUrl);
        if (!updated) {
            return sendError(res, 'Could not update profile photo.', 500);
        }
        return sendSuccess(res, 'Profile photo updated successfully', { avatar_url: avatarUrl });
    } catch (error) {
        next(error);
    }
};

/** Permanently delete the authenticated user's account after re-authentication. */
const deleteAccount = async (req, res, next) => {
    try {
        const password = String(req.body.password || '');
        if (!password) {
            return sendError(res, 'Enter your password to delete your account.', 400);
        }

        const user = await UserModel.findAuthById(req.user.user_id);
        if (!user || Number(user.user_id) !== Number(req.user.user_id)) {
            return sendError(res, 'Account not found.', 404);
        }

        const passwordMatches = await bcrypt.compare(password, user.password);
        if (!passwordMatches) {
            return sendError(res, 'Password is incorrect. Your account was not deleted.', 401);
        }

        const deleted = await UserModel.deleteAccount(user.user_id);
        if (!deleted) return sendError(res, 'Account could not be deleted.', 500);

        return sendSuccess(res, 'Your account and associated data were permanently deleted.');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    register,
    login,
    getGoogleConfig,
    googleLogin,
    getProfile,
    verifyEmail,
    updateProfile,
    updateAvatar,
    deleteAccount
};
