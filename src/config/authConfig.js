const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE_NAME = 'twineval_session';
const isProduction = () => process.env.NODE_ENV === 'production';

let cachedSecret = null;

/**
 * Returns the JWT signing secret.
 *  - production: JWT_SECRET is mandatory (min 32 chars); the app refuses to start without it.
 *  - development/test: JWT_SECRET is used when set. Otherwise a random secret is generated once
 *    and stored in database/.dev-jwt-secret (git-ignored) so dev sessions survive restarts.
 * There is intentionally no hardcoded fallback value.
 */
function getJwtSecret() {
    if (cachedSecret) return cachedSecret;
    const configured = String(process.env.JWT_SECRET || '').trim();
    const placeholder = configured === 'change_this_to_a_long_random_secret';
    if (configured && !placeholder) {
        if (isProduction() && configured.length < 32) {
            throw new Error('JWT_SECRET must be at least 32 characters in production.');
        }
        cachedSecret = configured;
        return cachedSecret;
    }
    if (isProduction()) {
        throw new Error('JWT_SECRET is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    }
    const file = path.resolve(__dirname, '../../database/.dev-jwt-secret');
    try {
        cachedSecret = fs.readFileSync(file, 'utf8').trim();
    } catch (_) { /* generate below */ }
    if (!cachedSecret) {
        cachedSecret = crypto.randomBytes(48).toString('hex');
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
        } catch (_) { /* read-only filesystem: ephemeral secret is fine for dev */ }
        console.warn('⚠️  JWT_SECRET is not set; using a generated development secret. Set JWT_SECRET in .env.');
    }
    return cachedSecret;
}

/** Fail fast at startup so a misconfigured production deploy never runs with a weak secret. */
function assertAuthConfig() {
    getJwtSecret();
}

const sessionLifetime = {
    remember: () => process.env.JWT_EXPIRES_IN || '7d',
    session: () => process.env.JWT_SESSION_EXPIRES_IN || '12h'
};

function durationToMs(value) {
    const match = /^(\d+)\s*([smhd])?$/i.exec(String(value).trim());
    if (!match) return 7 * 24 * 3600 * 1000;
    const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[(match[2] || 's').toLowerCase()];
    return Number(match[1]) * unit;
}

function cookieOptions({ persistent, maxAgeMs }) {
    const opts = {
        httpOnly: true,
        secure: isProduction(),
        sameSite: 'lax',
        path: '/'
    };
    if (persistent) opts.maxAge = maxAgeMs;
    return opts;
}

module.exports = { COOKIE_NAME, getJwtSecret, assertAuthConfig, sessionLifetime, durationToMs, cookieOptions, isProduction };
