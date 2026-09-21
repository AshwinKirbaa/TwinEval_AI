const { pool } = require('../config/db');

class EvaluationModel {
    /**
     * Create an evaluation result record
     */
    static async create({ student_id, subject, marks, attendance, communication, problem_solving, ai_score, remarks }) {
        const sql = `
            INSERT INTO EvaluationResult 
            (student_id, subject, marks, attendance, communication, problem_solving, ai_score, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await pool.execute(sql, [
            student_id,
            subject,
            marks,
            attendance,
            communication,
            problem_solving,
            ai_score,
            remarks || null
        ]);
        return result.insertId;
    }

    /**
     * Find evaluation by ID
     */
    static async findById(id) {
        const sql = `
            SELECT 
                e.*,
                s.name AS student_name,
                s.email AS student_email,
                s.department,
                s.semester
            FROM EvaluationResult e
            JOIN Student s ON e.student_id = s.student_id
            WHERE e.evaluation_id = ?
            LIMIT 1
        `;
        const [rows] = await pool.execute(sql, [id]);
        return rows[0] || null;
    }

    /**
     * Find all evaluations (with optional filters)
     */
    static async findAll({ student_id, subject, limit = 50 }) {
        let whereClauses = [];
        let queryParams = [];

        if (student_id) {
            whereClauses.push('e.student_id = ?');
            queryParams.push(student_id);
        }

        if (subject) {
            whereClauses.push('e.subject LIKE ?');
            queryParams.push(`%${subject}%`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const limitNum = Math.max(1, parseInt(limit));

        const sql = `
            SELECT 
                e.*,
                s.name AS student_name,
                s.department
            FROM EvaluationResult e
            JOIN Student s ON e.student_id = s.student_id
            ${whereSql}
            ORDER BY e.evaluated_at DESC
            LIMIT ${limitNum}
        `;
        const [rows] = await pool.execute(sql, queryParams);
        return rows;
    }

    /**
     * Update evaluation result
     */
    static async update(id, { subject, marks, attendance, communication, problem_solving, ai_score, remarks }) {
        const sql = `
            UPDATE EvaluationResult
            SET subject = ?, marks = ?, attendance = ?, communication = ?, problem_solving = ?, ai_score = ?, remarks = ?
            WHERE evaluation_id = ?
        `;
        const [result] = await pool.execute(sql, [
            subject,
            marks,
            attendance,
            communication,
            problem_solving,
            ai_score,
            remarks,
            id
        ]);
        return result.affectedRows > 0;
    }

    /**
     * Delete evaluation result
     */
    static async delete(id) {
        const sql = `DELETE FROM EvaluationResult WHERE evaluation_id = ?`;
        const [result] = await pool.execute(sql, [id]);
        return result.affectedRows > 0;
    }
}

module.exports = EvaluationModel;
