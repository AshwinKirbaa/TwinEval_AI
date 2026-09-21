const { pool } = require('../config/db');

class AnalyticsModel {
    /**
     * Complete Dashboard Overview API Query
     */
    static async getDashboardOverview() {
        // 1. Total Students Count
        const [studentCountResult] = await pool.execute('SELECT COUNT(*) AS total_students FROM Student');
        const totalStudents = studentCountResult[0].total_students;

        // 2. Average AI Score
        const [avgScoreResult] = await pool.execute('SELECT AVG(ai_score) AS average_ai_score FROM EvaluationResult');
        const averageAiScore = avgScoreResult[0].average_ai_score
            ? parseFloat(parseFloat(avgScoreResult[0].average_ai_score).toFixed(2))
            : 0;

        // 3. Highest Performer
        const [highestResult] = await pool.execute(`
            SELECT 
                s.student_id,
                s.name,
                s.department,
                e.ai_score,
                e.subject
            FROM EvaluationResult e
            JOIN Student s ON e.student_id = s.student_id
            ORDER BY e.ai_score DESC
            LIMIT 1
        `);
        const highestPerformer = highestResult[0] || null;

        // 4. Lowest Performer
        const [lowestResult] = await pool.execute(`
            SELECT 
                s.student_id,
                s.name,
                s.department,
                e.ai_score,
                e.subject
            FROM EvaluationResult e
            JOIN Student s ON e.student_id = s.student_id
            ORDER BY e.ai_score ASC
            LIMIT 1
        `);
        const lowestPerformer = lowestResult[0] || null;

        // 5. Department Statistics
        const [deptStats] = await pool.execute(`
            SELECT 
                s.department,
                COUNT(DISTINCT s.student_id) AS student_count,
                ROUND(AVG(e.ai_score), 2) AS average_ai_score,
                ROUND(AVG(e.marks), 2) AS average_marks
            FROM Student s
            LEFT JOIN EvaluationResult e ON s.student_id = e.student_id
            GROUP BY s.department
        `);

        // 6. Recent Evaluations
        const [recentEvals] = await pool.execute(`
            SELECT 
                e.evaluation_id,
                e.student_id,
                s.name AS student_name,
                s.department,
                e.subject,
                e.ai_score,
                e.evaluated_at
            FROM EvaluationResult e
            JOIN Student s ON e.student_id = s.student_id
            ORDER BY e.evaluated_at DESC
            LIMIT 5
        `);

        return {
            total_students: totalStudents,
            average_ai_score: averageAiScore,
            highest_performer: highestPerformer,
            lowest_performer: lowestPerformer,
            department_statistics: deptStats,
            recent_evaluations: recentEvals
        };
    }

    /**
     * Department level breakdown analytics
     */
    static async getDepartmentBreakdown() {
        const sql = `
            SELECT 
                s.department,
                COUNT(DISTINCT s.student_id) AS total_students,
                ROUND(AVG(e.ai_score), 2) AS avg_ai_score,
                ROUND(AVG(e.marks), 2) AS avg_marks,
                ROUND(AVG(e.attendance), 2) AS avg_attendance,
                ROUND(AVG(e.communication), 2) AS avg_communication,
                ROUND(AVG(e.problem_solving), 2) AS avg_problem_solving
            FROM Student s
            LEFT JOIN EvaluationResult e ON s.student_id = e.student_id
            GROUP BY s.department
            ORDER BY avg_ai_score DESC
        `;
        const [rows] = await pool.execute(sql);
        return rows;
    }

    /**
     * Overall platform performance metrics
     */
    static async getPerformanceMetrics() {
        const sql = `
            SELECT 
                COUNT(DISTINCT s.student_id) AS total_students_evaluated,
                COUNT(e.evaluation_id) AS total_evaluations_conducted,
                ROUND(AVG(e.ai_score), 2) AS platform_avg_ai_score,
                ROUND(MAX(e.ai_score), 2) AS platform_max_ai_score,
                ROUND(MIN(e.ai_score), 2) AS platform_min_ai_score,
                SUM(CASE WHEN e.ai_score >= 80 THEN 1 ELSE 0 END) AS top_performers_count,
                SUM(CASE WHEN e.ai_score < 60 THEN 1 ELSE 0 END) AS needs_attention_count
            FROM Student s
            JOIN EvaluationResult e ON s.student_id = e.student_id
        `;
        const [rows] = await pool.execute(sql);
        return rows[0] || {};
    }

    /**
     * Department Comparison Analytics
     */
    static async getDepartmentComparison() {
        const sql = `
            SELECT 
                s.department,
                COUNT(DISTINCT s.student_id) AS student_count,
                ROUND(AVG(e.ai_score), 2) AS avg_ai_score,
                ROUND(MAX(e.ai_score), 2) AS max_ai_score,
                ROUND(MIN(e.ai_score), 2) AS min_ai_score
            FROM Student s
            LEFT JOIN EvaluationResult e ON s.student_id = e.student_id
            GROUP BY s.department
        `;
        const [rows] = await pool.execute(sql);
        return rows;
    }

    /**
     * Fetch raw TeacherAnalytics rows
     */
    static async getAllTeacherAnalytics() {
        const sql = `SELECT * FROM TeacherAnalytics ORDER BY generated_on DESC`;
        const [rows] = await pool.execute(sql);
        return rows.map(r => {
            try {
                if (typeof r.top_students === 'string') r.top_students = JSON.parse(r.top_students);
                if (typeof r.weak_students === 'string') r.weak_students = JSON.parse(r.weak_students);
            } catch (e) {}
            return r;
        });
    }

    /**
     * Fetch single TeacherAnalytics by ID
     */
    static async getTeacherAnalyticsById(id) {
        const sql = `SELECT * FROM TeacherAnalytics WHERE analytics_id = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [id]);
        if (!rows[0]) return null;
        const record = rows[0];
        try {
            if (typeof record.top_students === 'string') record.top_students = JSON.parse(record.top_students);
            if (typeof record.weak_students === 'string') record.weak_students = JSON.parse(record.weak_students);
        } catch (e) {}
        return record;
    }
}

module.exports = AnalyticsModel;
