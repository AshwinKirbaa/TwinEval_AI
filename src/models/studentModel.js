const { pool } = require('../config/db');

class StudentModel {
    /**
     * Create new student
     */
    static async create({ name, email, department, semester, roll_no, user_id }) {
        const sql = `
            INSERT INTO Student (name, email, department, semester, roll_no, user_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [result] = await pool.execute(sql, [name, email, department, semester, roll_no || null, user_id || null]);
        return result.insertId;
    }

    /**
     * Find student by ID
     */
    static async findById(id) {
        const sql = `SELECT * FROM Student WHERE student_id = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [id]);
        return rows[0] || null;
    }

    /**
     * Find the Student row linked to a Users row (via Student.user_id).
     * Used to resolve "who is the logged-in student" for submissions.
     */
    static async findByUserId(userId) {
        const sql = `SELECT * FROM Student WHERE user_id = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [userId]);
        return rows[0] || null;
    }

    /**
     * Find student by Email
     */
    static async findByEmail(email) {
        const sql = `SELECT * FROM Student WHERE email = ? LIMIT 1`;
        const [rows] = await pool.execute(sql, [email]);
        return rows[0] || null;
    }

    /**
     * Get students with search, filter, pagination, and sorting
     */
    static async findAll({ department, semester, search, sortBy = 'student_id', order = 'ASC', page = 1, limit = 10 }) {
        let whereClauses = [];
        let queryParams = [];

        if (department) {
            whereClauses.push('s.department = ?');
            queryParams.push(department);
        }

        if (semester) {
            whereClauses.push('s.semester = ?');
            queryParams.push(parseInt(semester));
        }

        if (search) {
            whereClauses.push('(s.name LIKE ? OR s.email LIKE ? OR s.department LIKE ?)');
            const searchPattern = `%${search}%`;
            queryParams.push(searchPattern, searchPattern, searchPattern);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Validate sort column to prevent SQL injection
        const allowedSortColumns = {
            'student_id': 's.student_id',
            'name': 's.name',
            'email': 's.email',
            'department': 's.department',
            'semester': 's.semester',
            'ai_score': 'latest_ai_score'
        };
        const sortColumn = allowedSortColumns[sortBy] || 's.student_id';
        const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.max(1, parseInt(limit));
        const offset = (pageNum - 1) * limitNum;

        // Count total records
        const countSql = `SELECT COUNT(*) AS total FROM Student s ${whereSql}`;
        const [countResult] = await pool.execute(countSql, queryParams);
        const total = countResult[0].total;

        // Fetch paginated records with latest AI score JOIN
        const dataSql = `
            SELECT 
                s.student_id,
                s.name,
                s.email,
                s.department,
                s.semester,
                s.created_at,
                AVG(e.ai_score) AS average_ai_score,
                MAX(e.ai_score) AS latest_ai_score
            FROM Student s
            LEFT JOIN EvaluationResult e ON s.student_id = e.student_id
            ${whereSql}
            GROUP BY s.student_id
            ORDER BY ${sortColumn} ${sortOrder}
            LIMIT ${limitNum} OFFSET ${offset}
        `;

        const [rows] = await pool.execute(dataSql, queryParams);

        return {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            students: rows
        };
    }

    /**
     * Update student details
     */
    static async update(id, { name, email, department, semester }) {
        const sql = `
            UPDATE Student 
            SET name = ?, email = ?, department = ?, semester = ?
            WHERE student_id = ?
        `;
        const [result] = await pool.execute(sql, [name, email, department, semester, id]);
        return result.affectedRows > 0;
    }

    static async updateByUserId(userId, { name, email, department }) {
        const sql = `
            UPDATE Student
            SET name = ?, email = ?, department = ?
            WHERE user_id = ?
        `;
        const [result] = await pool.execute(sql, [name, email, department, userId]);
        return result.affectedRows > 0;
    }

    static async deleteByUserId(userId) {
        const sql = `DELETE FROM Student WHERE user_id = ?`;
        const [result] = await pool.execute(sql, [userId]);
        return result.affectedRows > 0;
    }

    /**
     * Delete student
     */
    static async delete(id) {
        const sql = `DELETE FROM Student WHERE student_id = ?`;
        const [result] = await pool.execute(sql, [id]);
        return result.affectedRows > 0;
    }

    /**
     * Leaderboard API Query
     */
    static async getLeaderboard(limit = 10) {
        const limitNum = Math.max(1, parseInt(limit));
        const sql = `
            SELECT 
                s.student_id,
                s.name,
                s.email,
                s.department,
                s.semester,
                ROUND(AVG(e.ai_score), 2) AS average_ai_score,
                ROUND(AVG(e.marks), 2) AS average_marks,
                COUNT(e.evaluation_id) AS total_evaluations
            FROM Student s
            INNER JOIN EvaluationResult e ON s.student_id = e.student_id
            GROUP BY s.student_id
            ORDER BY average_ai_score DESC
            LIMIT ${limitNum}
        `;
        const [rows] = await pool.execute(sql);
        return rows;
    }

    /**
     * Student Ranking API Query
     */
    static async getStudentRanking(studentId) {
        const sql = `
            WITH StudentScores AS (
                SELECT 
                    s.student_id,
                    s.name,
                    s.department,
                    COALESCE(AVG(e.ai_score), 0) AS avg_ai_score,
                    DENSE_RANK() OVER (ORDER BY COALESCE(AVG(e.ai_score), 0) DESC) as overall_rank,
                    DENSE_RANK() OVER (PARTITION BY s.department ORDER BY COALESCE(AVG(e.ai_score), 0) DESC) as dept_rank
                FROM Student s
                LEFT JOIN EvaluationResult e ON s.student_id = e.student_id
                GROUP BY s.student_id
            )
            SELECT * FROM StudentScores WHERE student_id = ?
        `;
        const [rows] = await pool.execute(sql, [studentId]);
        return rows[0] || null;
    }

    /**
     * Student Performance Trend Query over time
     */
    static async getStudentTrend(studentId) {
        const sql = `
            SELECT 
                evaluation_id,
                subject,
                marks,
                attendance,
                communication,
                problem_solving,
                ai_score,
                evaluated_at
            FROM EvaluationResult
            WHERE student_id = ?
            ORDER BY evaluated_at ASC
        `;
        const [rows] = await pool.execute(sql, [studentId]);
        return rows;
    }

    /**
     * Full Student Report API Query
     */
    static async getStudentFullReport(studentId) {
        // Student Basic Info
        const student = await this.findById(studentId);
        if (!student) return null;

        // Evaluations
        const evaluations = await this.getStudentTrend(studentId);

        // Calculate average AI score
        let totalAi = 0;
        evaluations.forEach(ev => { totalAi += parseFloat(ev.ai_score); });
        const averageAiScore = evaluations.length > 0 ? parseFloat((totalAi / evaluations.length).toFixed(2)) : 0;

        // Learning Plan
        const planSql = `
            SELECT * FROM LearningPlan 
            WHERE student_id = ? 
            ORDER BY generated_date DESC 
            LIMIT 1
        `;
        const [planRows] = await pool.execute(planSql, [studentId]);
        const learningPlan = planRows[0] || null;

        // Ranking
        const ranking = await this.getStudentRanking(studentId);

        return {
            student,
            summary: {
                total_evaluations: evaluations.length,
                average_ai_score: averageAiScore,
                overall_rank: ranking ? ranking.overall_rank : null,
                department_rank: ranking ? ranking.dept_rank : null
            },
            evaluations,
            learning_plan: learningPlan
        };
    }
}

module.exports = StudentModel;
