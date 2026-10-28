const crypto = require('crypto');
const { pool } = require('../config/db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Server-side sessions. The refresh token is an opaque random value stored
 * only as a SHA-256 hash; revoking a row immediately invalidates both the
 * refresh token and any access JWT carrying its session id (`sid`).
 */
class SessionModel {
    static ttlMs(remember) {
        return remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    }

    static async create(userId, { remember = false, userAgent = '' } = {}) {
        const sessionId = crypto.randomBytes(16).toString('hex');
        const refreshToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + SessionModel.ttlMs(remember)).toISOString();
        await pool.execute(
            `INSERT INTO AuthSession (session_id, user_id, refresh_hash, remember, expires_at, user_agent)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sessionId, userId, hashToken(refreshToken), remember ? 1 : 0, expiresAt, String(userAgent).slice(0, 255)]
        );
        return { sessionId, refreshToken };
    }

    static isActive(row) {
        return Boolean(row) && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
    }

    static async findActive(sessionId) {
        const [rows] = await pool.execute(`SELECT * FROM AuthSession WHERE session_id = ? LIMIT 1`, [String(sessionId || '')]);
        return SessionModel.isActive(rows[0]) ? rows[0] : null;
    }

    static async findActiveByRefreshToken(refreshToken) {
        if (!refreshToken) return null;
        const [rows] = await pool.execute(`SELECT * FROM AuthSession WHERE refresh_hash = ? LIMIT 1`, [hashToken(refreshToken)]);
        return SessionModel.isActive(rows[0]) ? rows[0] : null;
    }

    static async revoke(sessionId) {
        await pool.execute(
            `UPDATE AuthSession SET revoked_at = CURRENT_TIMESTAMP WHERE session_id = ? AND revoked_at IS NULL`,
            [String(sessionId || '')]
        );
    }

    static async revokeAllForUser(userId) {
        await pool.execute(
            `UPDATE AuthSession SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`,
            [userId]
        );
    }
}

module.exports = SessionModel;
