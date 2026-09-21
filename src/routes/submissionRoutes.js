const express = require('express');
const router = express.Router();
const submissionController = require('../controllers/submissionController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

/**
 * @route   POST /submissions/generate-job
 * @desc    Start a background evaluation job (OCR + split + evaluate)
 *          and get a submission id + job id back immediately to poll
 * @access  Private (student)
 */
router.post('/generate-job', verifyToken, authorizeRoles('student'), upload.single('file'), submissionController.startEvaluationJob);

/**
 * @route   GET /submissions/generate-job/:jobId
 * @desc    Poll live progress for an evaluation job
 * @access  Private (student)
 */
router.get('/generate-job/:jobId', verifyToken, authorizeRoles('student'), submissionController.getEvaluationJobStatus);

/**
 * @route   POST /submissions/:id/finalize
 * @desc    Persist a completed evaluation job's results against the submission
 * @access  Private (owning student)
 */
router.post('/:id/finalize', verifyToken, authorizeRoles('student'), submissionController.finalizeSubmission);

/**
 * @route   POST /submissions/:id/mark-failed
 * @desc    Transition a submission to 'failed' with the real error
 *          message, called when a background evaluation job errors out
 * @access  Private (owning student)
 */
router.post('/:id/mark-failed', verifyToken, authorizeRoles('student'), submissionController.markSubmissionFailed);

/**
 * @route   POST /submissions
 * @desc    Upload an answer sheet for a paper -> OCR + AI evaluation,
 *          fully persisted before responding (single blocking request;
 *          prefer /generate-job + /finalize for a UI that shows progress)
 * @access  Private (student)
 */
router.post('/', verifyToken, authorizeRoles('student'), upload.single('file'), submissionController.createSubmission);

/**
 * @route   GET /submissions
 * @desc    List submissions (student's own, or a teacher's paper's submissions)
 * @access  Private
 */
router.get('/', verifyToken, submissionController.getSubmissions);

/**
 * @route   GET /submissions/:id
 * @access  Private (owning student, or the paper's teacher/admin)
 */
router.get('/:id', verifyToken, submissionController.getSubmissionById);

/**
 * @route   GET /submissions/:id/report
 * @desc    Download the AI-generated PDF evaluation report
 * @access  Private (owning student, or the paper's teacher/admin)
 */
router.get('/:id/report', verifyToken, submissionController.downloadReport);

/**
 * @route   PUT /submissions/:id/override
 * @desc    Teacher review: override total marks / add comments
 * @access  Private (teacher/admin, owner)
 */
router.put('/:id/override', verifyToken, authorizeRoles('teacher', 'admin'), submissionController.overrideSubmission);

/**
 * @route   PUT /submissions/:id/questions/:resultId/override
 * @desc    Teacher review: override a single question's marks
 * @access  Private (teacher/admin, owner)
 */
router.put('/:id/questions/:resultId/override', verifyToken, authorizeRoles('teacher', 'admin'), submissionController.overrideQuestionResult);

/**
 * @route   POST /submissions/:id/questions/:resultId/flag
 * @desc    Flag a question's AI result for human review
 * @access  Private
 */
router.post('/:id/questions/:resultId/flag', verifyToken, submissionController.flagQuestionResult);

module.exports = router;
