const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { verifyToken, authorizeRoles, requireSelfOrStaff } = require('../middleware/authMiddleware');
const { validateStudent } = require('../middleware/validation');

/**
 * @route   GET /students/analytics/leaderboard
 * @desc    Get top performing students leaderboard
 * @access  Public / Private
 */
router.get('/analytics/leaderboard', verifyToken, authorizeRoles('teacher', 'admin'), studentController.getLeaderboard);

/**
 * @route   GET /students
 * @desc    Get all students with search, filter, pagination, and sorting
 * @access  Public / Private
 */
router.get('/', verifyToken, authorizeRoles('teacher', 'admin'), studentController.getStudents);

/**
 * @route   GET /students/:id
 * @desc    Get student by ID
 * @access  Public / Private
 */
router.get('/:id', verifyToken, requireSelfOrStaff('id'), studentController.getStudentById);

/**
 * @route   GET /students/:id/report
 * @desc    Get full student report (details, evaluations, AI score, learning plan)
 * @access  Public / Private
 */
router.get('/:id/report', verifyToken, requireSelfOrStaff('id'), studentController.getStudentReport);

/**
 * @route   GET /students/:id/ranking
 * @desc    Get student class and department rank
 * @access  Public / Private
 */
router.get('/:id/ranking', verifyToken, requireSelfOrStaff('id'), studentController.getStudentRanking);

/**
 * @route   GET /students/:id/trend
 * @desc    Get student performance trend over time
 * @access  Public / Private
 */
router.get('/:id/trend', verifyToken, requireSelfOrStaff('id'), studentController.getStudentTrend);

/**
 * @route   POST /students
 * @desc    Create a new student
 * @access  Private (Teacher/Admin)
 */
router.post('/', verifyToken, authorizeRoles('teacher', 'admin'), validateStudent, studentController.createStudent);

/**
 * @route   PUT /students/:id
 * @desc    Update student details
 * @access  Private (Teacher/Admin)
 */
router.put('/:id', verifyToken, authorizeRoles('teacher', 'admin'), validateStudent, studentController.updateStudent);

/**
 * @route   DELETE /students/:id
 * @desc    Delete student record
 * @access  Private (Teacher/Admin)
 */
router.delete('/:id', verifyToken, authorizeRoles('teacher', 'admin'), studentController.deleteStudent);

module.exports = router;
