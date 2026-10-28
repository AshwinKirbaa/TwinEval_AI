const rateLimit = require('express-rate-limit');

const num = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const emailKey = req => String((req.body && req.body.email) || '').trim().toLowerCase();

const make = (windowMinutes, max, message, keyByEmail = false) => rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByEmail ? (req => `${req.ip}|${emailKey(req)}`) : undefined,
    handler: (req, res) => res.status(429).json({ success: false, message })
});

// Limits are env-tunable (tests lower them); defaults suit production.
const loginLimiter = make(15, num('AUTH_LOGIN_MAX', 10), 'Too many sign-in attempts. Please wait a few minutes and try again.', true);
const registerLimiter = make(60, num('AUTH_REGISTER_MAX', 10), 'Too many registration attempts. Please try again later.');
const emailActionLimiter = make(60, num('AUTH_EMAIL_MAX', 5), 'Too many requests. Please try again later.', true);
const resetSubmitLimiter = make(15, num('AUTH_RESET_MAX', 10), 'Too many attempts. Please try again later.');

// Account-level brute-force guard, applied to known AND unknown emails alike
// so the lock itself never reveals whether an account exists. In-memory:
// resets on restart and is per-process.
const MAX_FAILURES = num('AUTH_LOCK_THRESHOLD', 5);
const LOCK_MS = num('AUTH_LOCK_MINUTES', 15) * 60 * 1000;
const failures = new Map();

const loginGuard = {
    isLocked(email) {
        const entry = failures.get(email);
        if (!entry) return false;
        if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true;
        if (entry.lockedUntil) failures.delete(email);
        return false;
    },
    recordFailure(email) {
        const entry = failures.get(email) || { count: 0, lockedUntil: 0 };
        entry.count += 1;
        if (entry.count >= MAX_FAILURES) entry.lockedUntil = Date.now() + LOCK_MS;
        failures.set(email, entry);
        if (failures.size > 10000) failures.clear();
    },
    reset(email) {
        failures.delete(email);
    }
};

module.exports = { loginLimiter, registerLimiter, emailActionLimiter, resetSubmitLimiter, loginGuard };
