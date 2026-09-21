const fs = require('fs');
const QuestionPaperModel = require('../models/questionPaperModel');
const aiBridge = require('../services/aiBridgeService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * POST /papers/generate-job
 * Starts a background generation job (OCR if a file is given -> split
 * into questions -> AI answer key per question) and returns
 * immediately with a job id to poll via GET /papers/generate-job/:id.
 * Nothing is written to the database yet -- see finalizePaper.
 * Access: Private (teacher/admin)
 */
const startGenerationJob = async (req, res, next) => {
    try {
        const { topic, default_max_marks, raw_text } = req.body;

        let fileBuffer = null;
        let filename = null;
        if (req.file) {
            fileBuffer = fs.readFileSync(req.file.path);
            filename = req.file.originalname;
        } else if (!raw_text || !raw_text.trim()) {
            return sendError(res, 'Provide raw_text or upload a question paper file.', 400);
        }

        const jobId = await aiBridge.createGenerationJob({
            fileBuffer, filename, rawText: raw_text, topic, defaultMaxMarks: parseFloat(default_max_marks) || 10.0
        });
        return sendSuccess(res, 'Generation started', { job_id: jobId }, 202);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /papers/generate-job/:jobId
 * Poll this for live progress: { done, error, stage, current, total,
 * message, result }. Once done+no error, `result` has
 * { questions, answer_keys } ready for POST /papers/finalize.
 * Access: Private (teacher/admin)
 */
const getGenerationJobStatus = async (req, res, next) => {
    try {
        const job = await aiBridge.getJobStatus(req.params.jobId);
        return sendSuccess(res, 'Job status retrieved', job);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /papers/finalize
 * Persists a completed generation job's result (questions + AI answer
 * keys, from GET /papers/generate-job/:id) as an actual QuestionPaper.
 * Access: Private (teacher/admin)
 */
const finalizePaper = async (req, res, next) => {
    try {
        const { title, subject, topic, pass_percentage, questions, answer_keys, source_file_path } = req.body;

        if (!title || !subject) {
            return sendError(res, 'title and subject are required.', 400);
        }
        if (!Array.isArray(questions) || !questions.length) {
            return sendError(res, 'No generated questions to save -- run generation again.', 400);
        }

        const paperId = await QuestionPaperModel.createPaper({
            teacher_id: req.user.user_id, title, subject, topic,
            pass_percentage: parseFloat(pass_percentage) || 40.0, source_file_path: source_file_path || null
        });
        const insertedQuestions = await QuestionPaperModel.addQuestions(paperId, questions);

        for (const q of insertedQuestions) {
            const key = (answer_keys || {})[q.ai_question_id];
            if (key) {
                await QuestionPaperModel.saveAnswerKey(q.question_id, key);
            }
        }

        const paper = await QuestionPaperModel.findById(paperId);
        return sendSuccess(res, 'Question paper saved successfully', paper, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /papers
 * Create a question paper: either from typed text (body.raw_text) or
 * an uploaded question-paper file (multipart 'file'), then run it
 * through the AI engine to split into questions and generate a full
 * AI answer key for each -- all stored in the database.
 *
 * Kept for backward compatibility / simple scripted use -- the
 * teacher-upload UI now uses startGenerationJob + finalizePaper above
 * so it can show live progress instead of one long blocking request.
 * Access: Private (teacher/admin)
 */
const createPaper = async (req, res, next) => {
    try {
        const { title, subject, topic, default_max_marks, pass_percentage, raw_text } = req.body;

        if (!title || !subject) {
            return sendError(res, 'title and subject are required.', 400);
        }

        let questionPaperText = raw_text || '';
        let sourceFilePath = null;

        if (req.file) {
            sourceFilePath = `/uploads/${req.file.filename}`;
            const buffer = fs.readFileSync(req.file.path);
            questionPaperText = await aiBridge.extractText(buffer, req.file.originalname);
        }

        if (!questionPaperText || !questionPaperText.trim()) {
            return sendError(res, 'No question text found -- provide raw_text or upload a readable question paper file.', 400);
        }

        // 1. Ask the AI engine to split the raw text into individual questions.
        const aiQuestions = await aiBridge.splitQuestions(
            questionPaperText, topic || '', parseFloat(default_max_marks) || 10.0
        );
        if (!aiQuestions.length) {
            return sendError(res, 'Could not identify any questions in the provided text.', 400);
        }

        // 2. Create the paper + question rows.
        const paperId = await QuestionPaperModel.createPaper({
            teacher_id: req.user.user_id, title, subject, topic,
            pass_percentage: parseFloat(pass_percentage) || 40.0, source_file_path: sourceFilePath
        });
        const insertedQuestions = await QuestionPaperModel.addQuestions(paperId, aiQuestions);

        // 3. Ask the AI engine to generate a full answer key per question.
        const answerKeys = await aiBridge.generateAnswerKeys(aiQuestions);
        for (const q of insertedQuestions) {
            const key = answerKeys[q.ai_question_id];
            if (key) {
                await QuestionPaperModel.saveAnswerKey(q.question_id, key);
            }
        }

        const paper = await QuestionPaperModel.findById(paperId);
        return sendSuccess(res, 'Question paper created and AI answer key generated successfully', paper, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /papers/:id/publish
 * Makes a paper visible to students for submission.
 * Access: Private (teacher/admin, owner)
 */
const publishPaper = async (req, res, next) => {
    try {
        const { id } = req.params;
        const paper = await QuestionPaperModel.findById(id);
        if (!paper) return sendError(res, 'Question paper not found', 404);
        if (paper.teacher_id !== req.user.user_id && req.user.role !== 'admin') {
            return sendError(res, 'You do not own this question paper.', 403);
        }

        await QuestionPaperModel.publishPaper(id);
        const updated = await QuestionPaperModel.findById(id);
        return sendSuccess(res, 'Question paper published', updated);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /papers
 * Students see only published papers; teachers see their own
 * (any status) via ?mine=true.
 * Access: Public / Private
 */
const getPapers = async (req, res, next) => {
    try {
        const { subject, mine } = req.query;
        const filters = { subject };

        if (mine === 'true' && req.user) {
            filters.teacher_id = req.user.user_id;
        } else {
            filters.status = 'published';
        }

        const papers = await QuestionPaperModel.findAll(filters);
        return sendSuccess(res, 'Question papers retrieved successfully', papers);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /papers/:id
 * Full paper detail including questions + AI answer keys.
 * Access: Public / Private
 */
const getPaperById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const paper = await QuestionPaperModel.findById(id);
        if (!paper) return sendError(res, 'Question paper not found', 404);
        return sendSuccess(res, 'Question paper retrieved successfully', paper);
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /papers/:id
 * Access: Private (teacher/admin, owner)
 */
const deletePaper = async (req, res, next) => {
    try {
        const { id } = req.params;
        const paper = await QuestionPaperModel.findById(id);
        if (!paper) return sendError(res, 'Question paper not found', 404);
        if (paper.teacher_id !== req.user.user_id && req.user.role !== 'admin') {
            return sendError(res, 'You do not own this question paper.', 403);
        }

        await QuestionPaperModel.delete(id);
        return sendSuccess(res, 'Question paper deleted successfully', { paper_id: parseInt(id) });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createPaper,
    startGenerationJob,
    getGenerationJobStatus,
    finalizePaper,
    publishPaper,
    getPapers,
    getPaperById,
    deletePaper
};
