const { pool } = require('../config/db');

class QuestionPaperModel {
    /**
     * Create a new (draft) question paper owned by a teacher.
     */
    static async createPaper({ teacher_id, title, subject, topic, pass_percentage, source_file_path }) {
        const sql = `
            INSERT INTO QuestionPaper (teacher_id, title, subject, topic, pass_percentage, source_file_path)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [result] = await pool.execute(sql, [
            teacher_id, title, subject, topic || null, pass_percentage || 40.0, source_file_path || null
        ]);
        return result.insertId;
    }

    /**
     * Insert the AI-split questions for a paper. Each item:
     * {id (ai_question_id), text, topic, max_marks, group_id?,
     * group_required?}. group_id/group_required carry the AI engine's
     * "answer any N of M questions" / "(OR)" alternative-section
     * detection (see reference Question.group_id/group_required) --
     * these MUST be persisted, or a paper's overall total will wrongly
     * count every question as mandatory instead of applying the
     * paper's actual "any N of M" choice-group rules.
     * Returns the inserted rows (with the real DB question_id
     * attached) so the caller can map ai_question_id -> question_id
     * for answer keys.
     */
    static async addQuestions(paperId, questions) {
        const inserted = [];
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const sql = `
                INSERT INTO Question (paper_id, ai_question_id, question_order, text, topic, max_marks, group_id, group_required)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const [result] = await pool.execute(sql, [
                paperId, q.id, i, q.text, q.topic || null, q.max_marks || 10.0,
                q.group_id || null, q.group_required != null ? q.group_required : null
            ]);
            inserted.push({ question_id: result.insertId, ai_question_id: q.id, ...q });
        }
        return inserted;
    }

    /**
     * Save (insert or replace) the AI-generated answer key for a question.
     */
    static async saveAnswerKey(questionId, data) {
        const sql = `
            INSERT INTO AnswerKey (question_id, data)
            VALUES (?, ?)
            ON CONFLICT(question_id) DO UPDATE SET
                data = excluded.data,
                generated_at = CURRENT_TIMESTAMP
        `;
        await pool.execute(sql, [questionId, JSON.stringify(data)]);
    }

    static async publishPaper(paperId) {
        await pool.execute(`UPDATE QuestionPaper SET status = 'published' WHERE paper_id = ?`, [paperId]);
    }

    static async findById(paperId) {
        const [papers] = await pool.execute(`
            SELECT qp.*, u.name AS teacher_name
            FROM QuestionPaper qp
            JOIN Users u ON qp.teacher_id = u.user_id
            WHERE qp.paper_id = ? LIMIT 1
        `, [paperId]);
        if (!papers[0]) return null;

        const questions = await this.getQuestionsForPaper(paperId);
        return { ...papers[0], questions };
    }

    /**
     * Questions for a paper, each with its answer key data attached
     * (null if not yet generated), including group_id/group_required
     * for "answer any N of M" choice-group handling.
     */
    static async getQuestionsForPaper(paperId) {
        const [rows] = await pool.execute(`
            SELECT q.question_id, q.ai_question_id, q.question_order, q.text, q.topic, q.max_marks,
                   q.group_id, q.group_required,
                   ak.data AS answer_key
            FROM Question q
            LEFT JOIN AnswerKey ak ON ak.question_id = q.question_id
            WHERE q.paper_id = ?
            ORDER BY q.question_order ASC
        `, [paperId]);

        return rows.map(r => ({
            ...r,
            answer_key: typeof r.answer_key === 'string' ? JSON.parse(r.answer_key) : r.answer_key
        }));
    }

    static async findAll({ teacher_id, status, subject } = {}) {
        const where = [];
        const params = [];
        if (teacher_id) { where.push('qp.teacher_id = ?'); params.push(teacher_id); }
        if (status) { where.push('qp.status = ?'); params.push(status); }
        if (subject) { where.push('qp.subject LIKE ?'); params.push(`%${subject}%`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [rows] = await pool.execute(`
            SELECT qp.*, u.name AS teacher_name,
                   (SELECT COUNT(*) FROM Question q WHERE q.paper_id = qp.paper_id) AS question_count,
                   (SELECT COUNT(*) FROM Submission s WHERE s.paper_id = qp.paper_id) AS submission_count
            FROM QuestionPaper qp
            JOIN Users u ON qp.teacher_id = u.user_id
            ${whereSql}
            ORDER BY qp.created_at DESC
        `, params);
        return rows;
    }

    static async delete(paperId) {
        const [result] = await pool.execute(`DELETE FROM QuestionPaper WHERE paper_id = ?`, [paperId]);
        return result.affectedRows > 0;
    }
}

module.exports = QuestionPaperModel;
