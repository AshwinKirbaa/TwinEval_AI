const express = require('express');
const router = express.Router();
const paperController = require('../controllers/paperController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

/**
 * @route   POST /papers/generate-job
 * @desc    Start a background AI generation job (OCR + split + answer
 *          keys) and get a job id back immediately to poll for progress
 * @access  Private (teacher/admin)
 */
router.post('/generate-job', verifyToken, authorizeRoles('teacher', 'admin'), upload.single('file'), paperController.startGenerationJob);

/**
 * @route   GET /papers/generate-job/:jobId
 * @desc    Poll live progress for a generation job
 * @access  Private (teacher/admin)
 */
router.get('/generate-job/:jobId', verifyToken, authorizeRoles('teacher', 'admin'), paperController.getGenerationJobStatus);

/**
 * @route   POST /papers/finalize
 * @desc    Persist a completed generation job's questions/answer keys as a real paper
 * @access  Private (teacher/admin)
 */
router.post('/finalize', verifyToken, authorizeRoles('teacher', 'admin'), paperController.finalizePaper);

/**
 * @route   POST /papers
 * @desc    Create a question paper (manual text or uploaded file) --
 *          AI splits it into questions and generates an answer key
 *          (single blocking request; prefer /generate-job + /finalize
 *          for a UI that shows progress)
 * @access  Private (teacher/admin)
 */
router.post('/', verifyToken, authorizeRoles('teacher', 'admin'), upload.single('file'), paperController.createPaper);

/**
 * @route   GET /papers
 * @desc    List question papers (published-only for students; a
 *          teacher's own via ?mine=true)
 * @access  Public / Private
 */
router.get('/', verifyToken, paperController.getPapers);

/**
 * @route   GET /papers/:id
 * @desc    Get a paper with its questions + AI answer keys
 * @access  Public / Private
 */
router.get('/:id', verifyToken, paperController.getPaperById);

/**
 * @route   PATCH /papers/:id/publish
 * @desc    Publish a paper so students can submit answers to it
 * @access  Private (teacher/admin, owner)
 */
router.patch('/:id/publish', verifyToken, authorizeRoles('teacher', 'admin'), paperController.publishPaper);

/**
 * @route   DELETE /papers/:id
 * @access  Private (teacher/admin, owner)
 */
router.delete('/:id', verifyToken, authorizeRoles('teacher', 'admin'), paperController.deletePaper);

module.exports = router;
