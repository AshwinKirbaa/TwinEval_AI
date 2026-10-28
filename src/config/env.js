const crypto = require('crypto');

const isProduction = () => process.env.NODE_ENV === 'production';

let devSecret = null;

/**
 * JWT signing secret. Required (>= 32 chars) in production; in
 * development a random per-process secret is used if none is configured
 * (sessions then end on server restart). There is no hardcoded fallback.
 */
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (secret && secret.length >= 32 && !/change_this/i.test(secret)) return secret;
    if (isProduction()) {
        throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production.');
    }
    if (!devSecret) {
        devSecret = crypto.randomBytes(48).toString('hex');
        if (process.env.NODE_ENV !== 'test') {
            console.warn('JWT_SECRET is not set (or too short); using a temporary secret. Sessions will reset on restart.');
        }
    }
    return devSecret;
}

/** Fail fast on startup when required configuration is missing. */
function validateEnv() {
    getJwtSecret();
}

function cookieSecure() {
    if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
    return isProduction();
}

/** Origins allowed to make credentialed cross-origin requests. */
function allowedOrigins() {
    const list = [process.env.PUBLIC_APP_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
        .map(value => String(value || '').trim().replace(/\/$/, ''))
        .filter(Boolean);
    return new Set(list);
}

module.exports = { getJwtSecret, validateEnv, cookieSecure, allowedOrigins, isProduction };
