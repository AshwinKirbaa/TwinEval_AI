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
        const sql = `SELECT * FROM Users WHERE email = ? COLLATE NOCASE LIMIT 1`;
        const [rows] = await pool.execute(sql, [String(email || '').trim()]);
        return rows[0] || null;
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

    /** Minimal identity record used to validate a session on every request. */
    static async findAuthById(id) {
        const sql = `SELECT user_id, name, email, role, password_changed_at FROM Users WHERE user_id = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [id]);
        return rows[0] || null;
    }

    /** Replace the password hash and invalidate every session issued before now. */
    static async updatePassword(id, passwordHash) {
        const sql = `UPDATE Users SET password = ?, password_changed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        const [result] = await pool.execute(sql, [passwordHash, new Date().toISOString(), id]);
        return result.affectedRows > 0;
    }

    static async createPasswordReset(userId, tokenHash, expiresAt) {
        await pool.execute(`UPDATE PasswordResetTokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, [new Date().toISOString(), userId]);
        await pool.execute(`INSERT INTO PasswordResetTokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`, [userId, tokenHash, expiresAt]);
    }

    static async findPasswordReset(tokenHash) {
        const [rows] = await pool.execute(`SELECT * FROM PasswordResetTokens WHERE token_hash = ? LIMIT 1`, [tokenHash]);
        return rows[0] || null;
    }

    /** Atomically consume a reset token; returns false if it was already used. */
    static async consumePasswordReset(resetId) {
        const [result] = await pool.execute(`UPDATE PasswordResetTokens SET used_at = ? WHERE reset_id = ? AND used_at IS NULL`, [new Date().toISOString(), resetId]);
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
