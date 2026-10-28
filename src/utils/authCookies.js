const jwt = require('jsonwebtoken');
const { getJwtSecret, cookieSecure } = require('../config/env');

const ACCESS_COOKIE = 'te_at';
const REFRESH_COOKIE = 'te_rt';
const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'twineval-ai', audience: 'twineval-web' };

const ACCESS_TTL = '15m';
const ACCESS_TTL_MS = 15 * 60 * 1000;

function baseCookie() {
    return { httpOnly: true, secure: cookieSecure(), sameSite: 'strict', path: '/' };
}

function signAccessToken(user, sessionId) {
    return jwt.sign(
        { user_id: user.user_id, role: user.role, sid: sessionId },
        getJwtSecret(),
        { ...JWT_OPTIONS, expiresIn: ACCESS_TTL }
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'], issuer: JWT_OPTIONS.issuer, audience: JWT_OPTIONS.audience
    });
}

function setAccessCookie(res, accessToken) {
    res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), maxAge: ACCESS_TTL_MS });
}

/**
 * @param {number|null} refreshMaxAgeMs persistent lifetime when "remember me"
 *   is chosen; null makes the refresh cookie a browser-session cookie.
 */
function setRefreshCookie(res, refreshToken, refreshMaxAgeMs) {
    const options = baseCookie();
    if (refreshMaxAgeMs) options.maxAge = refreshMaxAgeMs;
    res.cookie(REFRESH_COOKIE, refreshToken, options);
}

function clearAuthCookies(res) {
    res.clearCookie(ACCESS_COOKIE, baseCookie());
    res.clearCookie(REFRESH_COOKIE, baseCookie());
}

module.exports = {
    ACCESS_COOKIE, REFRESH_COOKIE,
    signAccessToken, verifyAccessToken,
    setAccessCookie, setRefreshCookie, clearAuthCookies
};
