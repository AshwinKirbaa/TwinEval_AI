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
        const sql = `SELECT * FROM Users WHERE email = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [email]);
        return rows[0] || null;
    }

    static async findByGoogleSubject(subject) {
        const sql = `SELECT * FROM Users WHERE google_subject = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [subject]);
        return rows[0] || null;
    }

    static async linkGoogleIdentity(id, subject) {
        const sql = `UPDATE Users SET google_subject = ?, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), verification_token_hash = NULL, verification_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        const [result] = await pool.execute(sql, [subject, id]);
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

    /** Internal authentication lookup; unlike findById, includes password. */
    static async findAuthById(id) {
        const sql = `SELECT * FROM Users WHERE user_id = ? LIMIT 1`;
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

    /**
     * Permanently remove an account and all data owned by it. Deleting a
     * linked Student row first activates the existing ON DELETE CASCADE
     * rules for submissions, results, plans, and evaluations. Teacher-owned
     * papers cascade when the Users row is deleted.
     */
    static async deleteAccount(id) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.execute('DELETE FROM Student WHERE user_id = ?', [id]);
            const [result] = await conn.execute('DELETE FROM Users WHERE user_id = ?', [id]);
            await conn.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

module.exports = UserModel;
