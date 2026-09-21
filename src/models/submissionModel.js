const { pool } = require('../config/db');

class SubmissionModel {
    static async createSubmission({ paper_id, student_id, answer_file_path }) {
        const sql = `
            INSERT INTO Submission (paper_id, student_id, answer_file_path, status)
            VALUES (?, ?, ?, 'processing')
        `;
        const [result] = await pool.execute(sql, [paper_id, student_id, answer_file_path || null]);
        return result.insertId;
    }

    /**
     * Persists the full AI evaluation outcome for a submission:
     * per-question QuestionResult rows plus the Submission's overall
     * totals/report. `questionIdByAiId` maps the AI engine's question
     * id -> the real Question.question_id so results can be linked
     * back to the right row.
     */
    static async saveEvaluationResults(submissionId, { rawExtractedText, results, overall, questionIdByAiId }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            for (const r of results) {
                const questionId = questionIdByAiId[r.question_id];
                if (!questionId) continue; // defensive: skip anything we can't link back
                await conn.execute(`
                    INSERT INTO QuestionResult
                        (submission_id, question_id, student_answer, marks, max_marks, percentage, grade,
                         is_off_topic, needs_review, full_result)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    submissionId, questionId, r.student_answer || '', r.marks || 0, r.max_marks || 0,
                    r.percentage || 0, r.grade || 'F', !!r.is_off_topic, !!r.needs_review,
                    JSON.stringify(r)
                ]);
            }

            await conn.execute(`
                UPDATE Submission
                SET raw_extracted_text = ?, total_marks = ?, max_marks = ?, percentage = ?, grade = ?,
                    pass_fail = ?, overall_report = ?, status = 'evaluated', evaluated_at = CURRENT_TIMESTAMP
                WHERE submission_id = ?
            `, [
                rawExtractedText || null, overall.total_marks || 0, overall.max_marks || 0,
                overall.percentage || 0, overall.grade || 'F', overall.pass_fail || 'Fail',
                JSON.stringify(overall), submissionId
            ]);

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    static async markFailed(submissionId, errorMessage = null) {
        await pool.execute(
            `UPDATE Submission SET status = 'failed', error_message = ? WHERE submission_id = ?`,
            [errorMessage, submissionId]
        );
    }

    static async findById(submissionId) {
        const [rows] = await pool.execute(`
            SELECT s.*, st.name AS student_name, st.roll_no, st.department, st.semester,
                   qp.title AS paper_title, qp.subject, qp.teacher_id,
                   u.name AS teacher_name
            FROM Submission s
            JOIN Student st ON s.student_id = st.student_id
            JOIN QuestionPaper qp ON s.paper_id = qp.paper_id
            JOIN Users u ON qp.teacher_id = u.user_id
            WHERE s.submission_id = ? LIMIT 1
        `, [submissionId]);
        if (!rows[0]) return null;

        const submission = rows[0];
        if (typeof submission.overall_report === 'string') {
            try { submission.overall_report = JSON.parse(submission.overall_report); } catch (e) { /* leave as-is */ }
        }

        const [results] = await pool.execute(`
            SELECT qr.*, q.text AS question_text, q.max_marks AS question_max_marks, q.question_order
            FROM QuestionResult qr
            JOIN Question q ON qr.question_id = q.question_id
            WHERE qr.submission_id = ?
            ORDER BY q.question_order ASC
        `, [submissionId]);

        submission.question_results = results.map(r => ({
            ...r,
            full_result: typeof r.full_result === 'string' ? JSON.parse(r.full_result) : r.full_result
        }));

        return submission;
    }

    static async findAll({ student_id, paper_id, teacher_id, status } = {}) {
        const where = [];
        const params = [];
        if (student_id) { where.push('s.student_id = ?'); params.push(student_id); }
        if (paper_id) { where.push('s.paper_id = ?'); params.push(paper_id); }
        if (teacher_id) { where.push('qp.teacher_id = ?'); params.push(teacher_id); }
        if (status) { where.push('s.status = ?'); params.push(status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [rows] = await pool.execute(`
            SELECT s.submission_id, s.paper_id, s.student_id, s.total_marks, s.max_marks, s.percentage,
                   s.grade, s.pass_fail, s.status, s.error_message, s.teacher_override_marks, s.submitted_at, s.evaluated_at,
                   st.name AS student_name, st.roll_no,
                   qp.title AS paper_title, qp.subject
            FROM Submission s
            JOIN Student st ON s.student_id = st.student_id
            JOIN QuestionPaper qp ON s.paper_id = qp.paper_id
            ${whereSql}
            ORDER BY s.submitted_at DESC
        `, params);
        return rows;
    }

    static async overrideMarks(submissionId, { teacher_override_marks, teacher_comments }) {
        const [result] = await pool.execute(`
            UPDATE Submission
            SET teacher_override_marks = ?, teacher_comments = ?, status = 'reviewed'
            WHERE submission_id = ?
        `, [teacher_override_marks, teacher_comments || null, submissionId]);
        return result.affectedRows > 0;
    }

    static async overrideQuestionMarks(resultId, teacherMarks) {
        const [result] = await pool.execute(`
            UPDATE QuestionResult SET teacher_override_marks = ? WHERE result_id = ?
        `, [teacherMarks, resultId]);
        return result.affectedRows > 0;
    }
}

module.exports = SubmissionModel;
