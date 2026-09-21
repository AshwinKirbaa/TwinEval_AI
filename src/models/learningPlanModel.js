const { pool } = require('../config/db');

class LearningPlanModel {
    /**
     * Create a learning plan record
     */
    static async create({ student_id, weak_topics, recommended_resources, practice_tasks, study_schedule }) {
        const sql = `
            INSERT INTO LearningPlan (student_id, weak_topics, recommended_resources, practice_tasks, study_schedule)
            VALUES (?, ?, ?, ?, ?)
        `;
        const [result] = await pool.execute(sql, [
            student_id,
            JSON.stringify(weak_topics),
            JSON.stringify(recommended_resources),
            JSON.stringify(practice_tasks),
            study_schedule ? JSON.stringify(study_schedule) : null
        ]);
        return result.insertId;
    }

    /**
     * Find learning plan by ID
     */
    static async findById(id) {
        const sql = `
            SELECT 
                lp.*,
                s.name AS student_name,
                s.email AS student_email,
                s.department
            FROM LearningPlan lp
            JOIN Student s ON lp.student_id = s.student_id
            WHERE lp.plan_id = ?
            LIMIT 1
        `;
        const [rows] = await pool.execute(sql, [id]);
        if (!rows[0]) return null;

        const record = rows[0];
        return this.parseJSONFields(record);
    }

    /**
     * Find latest plan by Student ID
     */
    static async findByStudentId(studentId) {
        const sql = `
            SELECT * FROM LearningPlan
            WHERE student_id = ?
            ORDER BY generated_date DESC
            LIMIT 1
        `;
        const [rows] = await pool.execute(sql, [studentId]);
        if (!rows[0]) return null;
        return this.parseJSONFields(rows[0]);
    }

    /**
     * Find all learning plans
     */
    static async findAll() {
        const sql = `
            SELECT 
                lp.*,
                s.name AS student_name,
                s.department
            FROM LearningPlan lp
            JOIN Student s ON lp.student_id = s.student_id
            ORDER BY lp.generated_date DESC
        `;
        const [rows] = await pool.execute(sql);
        return rows.map(r => this.parseJSONFields(r));
    }

    /**
     * Update learning plan
     */
    static async update(id, { weak_topics, recommended_resources, practice_tasks, study_schedule }) {
        const sql = `
            UPDATE LearningPlan
            SET weak_topics = ?, recommended_resources = ?, practice_tasks = ?, study_schedule = ?
            WHERE plan_id = ?
        `;
        const [result] = await pool.execute(sql, [
            JSON.stringify(weak_topics),
            JSON.stringify(recommended_resources),
            JSON.stringify(practice_tasks),
            study_schedule ? JSON.stringify(study_schedule) : null,
            id
        ]);
        return result.affectedRows > 0;
    }

    /**
     * Delete learning plan
     */
    static async delete(id) {
        const sql = `DELETE FROM LearningPlan WHERE plan_id = ?`;
        const [result] = await pool.execute(sql, [id]);
        return result.affectedRows > 0;
    }

    /**
     * Helper to safely parse JSON columns
     */
    static parseJSONFields(record) {
        if (!record) return record;

        try {
            if (typeof record.weak_topics === 'string') {
                record.weak_topics = JSON.parse(record.weak_topics);
            }
            if (typeof record.recommended_resources === 'string') {
                record.recommended_resources = JSON.parse(record.recommended_resources);
            }
            if (typeof record.practice_tasks === 'string') {
                record.practice_tasks = JSON.parse(record.practice_tasks);
            }
            if (record.study_schedule && typeof record.study_schedule === 'string') {
                record.study_schedule = JSON.parse(record.study_schedule);
            }
        } catch (e) {
            // Keep original string if parsing fails
        }
        return record;
    }
}

module.exports = LearningPlanModel;
