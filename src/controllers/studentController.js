const StudentModel = require('../models/studentModel');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * GET /students
 * List students with pagination, search, department/semester filter, and sorting
 */
const getStudents = async (req, res, next) => {
    try {
        const { department, semester, search, sortBy, order, page, limit } = req.query;

        const result = await StudentModel.findAll({
            department,
            semester,
            search,
            sortBy,
            order,
            page,
            limit
        });

        return sendSuccess(res, 'Students retrieved successfully', result);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /students/:id
 * Get single student by ID
 */
const getStudentById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const student = await StudentModel.findById(id);

        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        return sendSuccess(res, 'Student details retrieved successfully', student);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /students
 * Create a new student
 */
const createStudent = async (req, res, next) => {
    try {
        const { name, email, department, semester } = req.body;

        // Check if student email exists
        const existing = await StudentModel.findByEmail(email);
        if (existing) {
            return sendError(res, 'A student with this email already exists.', 400);
        }

        const studentId = await StudentModel.create({ name, email, department, semester });
        const newStudent = await StudentModel.findById(studentId);

        return sendSuccess(res, 'Student created successfully', newStudent, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /students/:id
 * Update student record
 */
const updateStudent = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, email, department, semester } = req.body;

        const student = await StudentModel.findById(id);
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        const updated = await StudentModel.update(id, { name, email, department, semester });
        if (!updated) {
            return sendError(res, 'Failed to update student record', 400);
        }

        const updatedStudent = await StudentModel.findById(id);
        return sendSuccess(res, 'Student record updated successfully', updatedStudent);
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /students/:id
 * Delete student record
 */
const deleteStudent = async (req, res, next) => {
    try {
        const { id } = req.params;

        const student = await StudentModel.findById(id);
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        await StudentModel.delete(id);
        return sendSuccess(res, 'Student deleted successfully', { student_id: parseInt(id) });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /students/:id/report
 * Generate comprehensive student evaluation report
 */
const getStudentReport = async (req, res, next) => {
    try {
        const { id } = req.params;
        const report = await StudentModel.getStudentFullReport(id);

        if (!report) {
            return sendError(res, 'Student not found', 404);
        }

        return sendSuccess(res, 'Student evaluation report generated successfully', report);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /students/analytics/leaderboard
 * Top performing students leaderboard
 */
const getLeaderboard = async (req, res, next) => {
    try {
        const limit = req.query.limit || 10;
        const leaderboard = await StudentModel.getLeaderboard(limit);
        return sendSuccess(res, 'Leaderboard retrieved successfully', leaderboard);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /students/:id/ranking
 * Individual student rank
 */
const getStudentRanking = async (req, res, next) => {
    try {
        const { id } = req.params;
        const ranking = await StudentModel.getStudentRanking(id);

        if (!ranking) {
            return sendError(res, 'Student ranking not found', 404);
        }

        return sendSuccess(res, 'Student rank retrieved successfully', ranking);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /students/:id/trend
 * Student performance trend over evaluations
 */
const getStudentTrend = async (req, res, next) => {
    try {
        const { id } = req.params;
        const student = await StudentModel.findById(id);

        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        const trend = await StudentModel.getStudentTrend(id);
        return sendSuccess(res, 'Student performance trend retrieved successfully', {
            student_id: parseInt(id),
            name: student.name,
            trend
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getStudents,
    getStudentById,
    createStudent,
    updateStudent,
    deleteStudent,
    getStudentReport,
    getLeaderboard,
    getStudentRanking,
    getStudentTrend
};
