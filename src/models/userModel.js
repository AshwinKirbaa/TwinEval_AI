const normalizeEmailLegacy = require('validator/lib/normalizeEmail').default;
const { pool } = require('../config/db');

class UserModel {
    /**
     * Create a new user
     */
    static async create({ name, email, password, role = 'teacher', college = '', department = '', year = '', verificationTokenHash = null, verificationExpiresAt = null }) {
        const sql = `
            INSERT INTO Users (name, email, password, role, college, department, year, verification_token_hash, verification_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await pool.execute(sql, [name, email, password, role, college, department, year, verificationTokenHash, verificationExpiresAt]);
        return result.insertId;
    }

    /**
     * Find user by email address
     */
    static async findByEmail(email) {
        const sql = `SELECT * FROM Users WHERE lower(email) = ? LIMIT 1`;
        const lowered = String(email || '').trim().toLowerCase();
        const [rows] = await pool.execute(sql, [lowered]);
        if (rows[0]) return rows[0];
        // Accounts created before email handling was unified had their address
        // rewritten by validator's normalizeEmail (e.g. Gmail dots removed).
        const legacy = normalizeEmailLegacy(lowered);
        if (legacy && legacy !== lowered) {
            const [legacyRows] = await pool.execute(sql, [legacy]);
            return legacyRows[0] || null;
        }
        return null;
    }

    /** Minimal, non-sensitive user context used to authorize each request. */
    static async findAuthContext(id) {
        const sql = `
            SELECT u.user_id, u.name, u.email, u.role, u.account_status, u.email_verified_at, s.student_id
            FROM Users u LEFT JOIN Student s ON s.user_id = u.user_id
            WHERE u.user_id = ? LIMIT 1
        `;
        const [rows] = await pool.execute(sql, [id]);
        return rows[0] || null;
    }

    static async setVerificationToken(id, tokenHash, expiresAt) {
        await pool.execute(
            `UPDATE Users SET verification_token_hash = ?, verification_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
            [tokenHash, expiresAt, id]
        );
    }

    static async setResetToken(id, tokenHash, expiresAt) {
        await pool.execute(
            `UPDATE Users SET reset_token_hash = ?, reset_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
            [tokenHash, expiresAt, id]
        );
    }

    static async findByResetTokenHash(tokenHash) {
        const [rows] = await pool.execute(`SELECT * FROM Users WHERE reset_token_hash = ? LIMIT 1`, [tokenHash]);
        return rows[0] || null;
    }

    /** Replace the password hash and burn any outstanding reset token. */
    static async updatePassword(id, passwordHash) {
        const [result] = await pool.execute(
            `UPDATE Users SET password = ?, reset_token_hash = NULL, reset_expires_at = NULL,
                    password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
            [passwordHash, id]
        );
        return result.affectedRows > 0;
    }

    /**
     * Find user by ID
     */
    static async findById(id) {
        const sql = `SELECT user_id, name, email, role, avatar_url, college, department, year, created_at FROM Users WHERE user_id = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [id]);
        return rows[0] || null;
    }

    /**
     * Persist the editable profile fields for the authenticated user.
     * The caller supplies only values from the verified session; user_id is
     * never accepted from the browser payload.
     */
    static async updateProfile(id, { name, email, college, department, year }) {
        const sql = `
            UPDATE Users
            SET name = ?, email = ?, college = ?, department = ?, year = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `;
        const [result] = await pool.execute(sql, [name, email, college, department, year, id]);
        return result.affectedRows > 0;
    }

    /**
     * Get all users
     */
    static async getAll() {
        const sql = `SELECT user_id, name, email, role, created_at FROM Users ORDER BY user_id DESC`;
        const [rows] = await pool.execute(sql);
        return rows;
    }

    /**
     * Update a user's profile photo. Only ever called with the ID of
     * the AUTHENTICATED user themselves (from their verified JWT) --
     * never a client-supplied user id -- so a user can only ever
     * change their own avatar.
     */
    static async updateAvatar(id, avatarUrl) {
        const sql = `UPDATE Users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        const [result] = await pool.execute(sql, [avatarUrl, id]);
        return result.affectedRows > 0;
    }

    static async findByVerificationTokenHash(tokenHash) {
        const sql = `SELECT * FROM Users WHERE verification_token_hash = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [tokenHash]);
        return rows[0] || null;
    }

    static async markEmailVerified(id) {
        const sql = `UPDATE Users SET email_verified_at = CURRENT_TIMESTAMP, verification_token_hash = NULL, verification_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        const [result] = await pool.execute(sql, [id]);
        return result.affectedRows > 0;
    }

    static async deleteById(id) {
        const sql = `DELETE FROM Users WHERE user_id = ?`;
        const [result] = await pool.execute(sql, [id]);
        return result.affectedRows > 0;
    }
}

module.exports = UserModel;
