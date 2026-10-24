const { sendError } = require('../utils/responseHandler');

/**
 * Small dependency-free in-memory rate limiter (per client IP + route key).
 * Suitable for a single Node process; use a shared store if you scale out.
 */
function rateLimit({ windowMs, max, key = 'default', message = 'Too many attempts. Please wait a few minutes and try again.' }) {
    const hits = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }, Math.max(windowMs, 60000));
    if (timer.unref) timer.unref();

    return (req, res, next) => {
        if (process.env.RATE_LIMIT_DISABLED === 'true') return next();
        const id = `${key}:${req.ip}`;
        const now = Date.now();
        let entry = hits.get(id);
        if (!entry || entry.reset <= now) {
            entry = { count: 0, reset: now + windowMs };
            hits.set(id, entry);
        }
        entry.count += 1;
        if (entry.count > max) {
            res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
            return sendError(res, message, 429);
        }
        next();
    };
}

module.exports = { rateLimit };
