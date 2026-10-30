const QuestionPaperModel = require('../models/questionPaperModel');
const SubmissionModel = require('../models/submissionModel');
const StudentModel = require('../models/studentModel');
const aiBridge = require('../services/aiBridgeService');
const { persistUpload } = require('../services/storageService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * POST /submissions/generate-job
 * Creates a "processing" Submission row immediately, then starts a
 * background evaluation job (OCR -> split answers -> evaluate) and
 * returns both ids so the client can poll for progress via
 * GET /submissions/generate-job/:jobId, then persist with
 * POST /submissions/:id/finalize once done.
 *
 * This replaces one long blocking request (OCR + N evaluation calls,
 * each a real local LLM call, easily several minutes for a full
 * paper) with the same resilient job-polling pattern already used for
 * paper generation -- a single dropped/slow request no longer throws
 * away evaluation work that was actually completing successfully.
 * Access: Private (student)
 */
const startEvaluationJob = async (req, res, next) => {
    let submissionId = null;
    try {
        const { paper_id } = req.body;
        if (!paper_id) return sendError(res, 'paper_id is required.', 400);
        if (!req.file) return sendError(res, 'An answer sheet file is required.', 400);

        const student = await StudentModel.findByUserId(req.user.user_id);
        if (!student) {
            return sendError(res, 'No student profile linked to this account. Please contact your teacher.', 400);
        }

        const paper = await QuestionPaperModel.findById(paper_id);
        if (!paper) return sendError(res, 'Question paper not found.', 404);
        if (!paper.questions.length) return sendError(res, 'This question paper has no questions yet.', 400);

        const answerFilePath = await persistUpload(req.file, 'answer-sheets');
        submissionId = await SubmissionModel.createSubmission({
            paper_id, student_id: student.student_id, answer_file_path: answerFilePath
        });

        const aiQuestions = [];
        const answerKeysByAiId = {};
        for (const q of paper.questions) {
            aiQuestions.push({
                id: q.ai_question_id, text: q.text, topic: q.topic, max_marks: parseFloat(q.max_marks),
                group_id: q.group_id || null, group_required: q.group_required != null ? q.group_required : null
            });
            answerKeysByAiId[q.ai_question_id] = q.answer_key || {};
        }

        // In multi-system mode the browser runs the AI engine locally on
        // the same computer as the user. The central Node server only
        // creates the submission and returns the exact data needed by the
        // local AI engine. This keeps Ollama/LLM workloads off the server.
        if (String(req.body.local_ai || '').toLowerCase() === 'true') {
            return sendSuccess(res, 'Submission prepared for local AI evaluation', {
                submission_id: submissionId,
                ai_questions: aiQuestions,
                answer_keys: answerKeysByAiId,
                pass_percentage: parseFloat(paper.pass_percentage) || 40.0
            }, 202);
        }

        const buffer = req.file.buffer;
        const jobId = await aiBridge.createSubmissionEvaluationJob({
            fileBuffer: buffer, filename: req.file.originalname,
            questions: aiQuestions, answerKeys: answerKeysByAiId,
            passPercentage: parseFloat(paper.pass_percentage) || 40.0
        });

        return sendSuccess(res, 'Evaluation started', { submission_id: submissionId, job_id: jobId }, 202);
    } catch (error) {
        if (submissionId) {
            try { await SubmissionModel.markFailed(submissionId, error.message); } catch (e) { /* best effort */ }
        }
        next(error);
    }
};

/**
 * GET /submissions/generate-job/:jobId
 * Poll live progress: { done, error, stage, current, total, message, result }
 * Access: Private (student)
 */
const getEvaluationJobStatus = async (req, res, next) => {
    try {
        const job = await aiBridge.getJobStatus(req.params.jobId);
        return sendSuccess(res, 'Job status retrieved', job);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /submissions/:id/finalize
 * Persists a completed evaluation job's result against the
 * "processing" Submission row created by startEvaluationJob.
 * Access: Private (owning student)
 */
const finalizeSubmission = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { questions, raw_text, results, overall } = req.body;

        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);

        // Resolve ownership through the Student row rather than trusting
        // req.user.student_id off the JWT directly -- a stale/older
        // token (issued before this account had a linked Student row,
        // or from before a fix like this landed) can carry a null or
        // out-of-date student_id and would otherwise reject a
        // legitimately-completed evaluation right at the final save
        // step. Mirrors markSubmissionFailed below.
        const student = await StudentModel.findByUserId(req.user.user_id);
        if (!student || Number(student.student_id) !== Number(submission.student_id)) {
            return sendError(res, 'You do not own this submission.', 403);
        }
        if (!Array.isArray(results) || !results.length) {
            return sendError(res, 'No evaluation results to save -- run evaluation again.', 400);
        }

        const paper = await QuestionPaperModel.findById(submission.paper_id);
        const questionIdByAiId = {};
        for (const q of paper.questions) {
            questionIdByAiId[q.ai_question_id] = q.question_id;
        }

        await SubmissionModel.saveEvaluationResults(id, {
            rawExtractedText: raw_text, results, overall, questionIdByAiId
        });

        const fullSubmission = await SubmissionModel.findById(id);
        return sendSuccess(res, 'Answer sheet evaluated successfully', fullSubmission);
    } catch (error) {
        try { await SubmissionModel.markFailed(req.params.id, error.message); } catch (e) { /* best effort */ }
        next(error);
    }
};

/**
 * POST /submissions/:id/mark-failed
 * Called by the client when a background evaluation job reports an
 * error, so the submission actually transitions to 'failed' with the
 * real error message -- without this, a failed job leaves its
 * "processing" Submission row orphaned forever (worse than the old
 * single-request path, which at least reached a terminal state).
 * Access: Private (owning student)
 */
const markSubmissionFailed = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { error } = req.body;

        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);
        const student = await StudentModel.findByUserId(req.user.user_id);
        if (!student || Number(student.student_id) !== Number(submission.student_id)) {
            return sendError(res, 'You do not own this submission.', 403);
        }

        await SubmissionModel.markFailed(id, error || 'Evaluation failed for an unknown reason.');
        return sendSuccess(res, 'Submission marked as failed', { submission_id: parseInt(id) });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /submissions
 * Student uploads their answer sheet for a given paper. Runs the full
 * AI pipeline synchronously (OCR -> split answers -> evaluate) and
 * persists every result before responding.
 *
 * Kept for backward compatibility / simple scripted use -- the
 * upload-answer UI now uses startEvaluationJob + finalizeSubmission
 * above so it can show live progress and survive transient network
 * hiccups over however long a full evaluation takes.
 * Access: Private (student)
 */
const createSubmission = async (req, res, next) => {
    let submissionId = null;
    try {
        const { paper_id } = req.body;
        if (!paper_id) return sendError(res, 'paper_id is required.', 400);
        if (!req.file) return sendError(res, 'An answer sheet file is required.', 400);

        const student = await StudentModel.findByUserId(req.user.user_id);
        if (!student) {
            return sendError(res, 'No student profile linked to this account. Please contact your teacher.', 400);
        }

        const paper = await QuestionPaperModel.findById(paper_id);
        if (!paper) return sendError(res, 'Question paper not found.', 404);
        if (!paper.questions.length) return sendError(res, 'This question paper has no questions yet.', 400);

        const answerFilePath = await persistUpload(req.file, 'answer-sheets');
        submissionId = await SubmissionModel.createSubmission({
            paper_id, student_id: student.student_id, answer_file_path: answerFilePath
        });

        // 1. OCR the uploaded answer sheet.
        const buffer = req.file.buffer;
        const rawText = await aiBridge.extractText(buffer, req.file.originalname);
        if (!rawText || !rawText.trim()) {
            await SubmissionModel.markFailed(submissionId, 'No text could be extracted from the uploaded answer sheet.');
            return sendError(res, 'No text could be extracted from the uploaded answer sheet.', 422);
        }

        // 2. Build the AI-engine-shaped question/answer-key structures
        // from what's stored in the DB, and map ai_question_id -> real
        // Question.question_id so results can be linked back after.
        const aiQuestions = [];
        const answerKeysByAiId = {};
        const questionIdByAiId = {};
        for (const q of paper.questions) {
            aiQuestions.push({
                id: q.ai_question_id, text: q.text, topic: q.topic, max_marks: parseFloat(q.max_marks),
                group_id: q.group_id || null, group_required: q.group_required != null ? q.group_required : null
            });
            answerKeysByAiId[q.ai_question_id] = q.answer_key || {};
            questionIdByAiId[q.ai_question_id] = q.question_id;
        }

        // 3. Split the OCR'd text into per-question answers.
        const studentAnswers = await aiBridge.splitAnswers(rawText, aiQuestions);

        // 4. Evaluate.
        const { results, overall } = await aiBridge.evaluate(
            aiQuestions, answerKeysByAiId, studentAnswers, parseFloat(paper.pass_percentage) || 40.0
        );

        // 5. Persist.
        await SubmissionModel.saveEvaluationResults(submissionId, {
            rawExtractedText: rawText, results, overall, questionIdByAiId
        });

        const fullSubmission = await SubmissionModel.findById(submissionId);
        return sendSuccess(res, 'Answer sheet evaluated successfully', fullSubmission, 201);
    } catch (error) {
        if (submissionId) {
            try { await SubmissionModel.markFailed(submissionId, error.message); } catch (e) { /* best effort */ }
        }
        next(error);
    }
};

/**
 * GET /submissions/:id
 * Access: Private (owning student, or the paper's teacher/admin)
 */
const getSubmissionById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);

        // Resolve ownership via the Student row (not the JWT's
        // student_id directly) for the same reason as finalizeSubmission
        // above -- a stale token shouldn't be able to lock a student out
        // of their own just-completed results.
        const student = req.user.role === 'student' ? await StudentModel.findByUserId(req.user.user_id) : null;
        const isOwner = !!student && Number(student.student_id) === Number(submission.student_id);
        const isTeacher = req.user.user_id === submission.teacher_id || req.user.role === 'admin';
        if (!isOwner && !isTeacher) {
            return sendError(res, 'You do not have access to this submission.', 403);
        }

        return sendSuccess(res, 'Submission retrieved successfully', submission);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /submissions
 * ?student_id=&paper_id= for a student's own list; teachers pass
 * ?paper_id= (their own paper) to see all submissions for review.
 * Access: Private
 */
const getSubmissions = async (req, res, next) => {
    try {
        const { paper_id, student_id, status } = req.query;
        const filters = { paper_id, status };

        if (req.user.role === 'student') {
            const student = await StudentModel.findByUserId(req.user.user_id);
            filters.student_id = student ? student.student_id : -1;
        } else {
            filters.student_id = student_id;
            filters.teacher_id = req.user.role === 'teacher' ? req.user.user_id : undefined;
        }

        const submissions = await SubmissionModel.findAll(filters);
        return sendSuccess(res, 'Submissions retrieved successfully', submissions);
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /submissions/:id/override
 * Teacher review: override the AI's total marks/add comments.
 * Access: Private (teacher/admin, owner of the paper)
 */
const overrideSubmission = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { teacher_override_marks, teacher_comments } = req.body;

        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);
        if (submission.teacher_id !== req.user.user_id && req.user.role !== 'admin') {
            return sendError(res, 'You do not own the paper this submission belongs to.', 403);
        }

        await SubmissionModel.overrideMarks(id, { teacher_override_marks, teacher_comments });
        const updated = await SubmissionModel.findById(id);
        return sendSuccess(res, 'Submission reviewed and updated successfully', updated);
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /submissions/:id/questions/:resultId/override
 * Per-question marks override.
 * Access: Private (teacher/admin, owner)
 */
const overrideQuestionResult = async (req, res, next) => {
    try {
        const { id, resultId } = req.params;
        const { teacher_marks } = req.body;

        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);
        if (submission.teacher_id !== req.user.user_id && req.user.role !== 'admin') {
            return sendError(res, 'You do not own the paper this submission belongs to.', 403);
        }

        await SubmissionModel.overrideQuestionMarks(resultId, teacher_marks);
        const updated = await SubmissionModel.findById(id);
        return sendSuccess(res, 'Question result updated successfully', updated);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /submissions/:id/report
 * Streams back the AI-generated PDF report for this submission.
 * Access: Private (owning student, or the paper's teacher/admin)
 */
const downloadReport = async (req, res, next) => {
    try {
        const { id } = req.params;
        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);

        const ownerStudent = req.user.role === 'student' ? await StudentModel.findByUserId(req.user.user_id) : null;
        const isOwner = !!ownerStudent && Number(ownerStudent.student_id) === Number(submission.student_id);
        const isTeacher = req.user.user_id === submission.teacher_id || req.user.role === 'admin';
        if (!isOwner && !isTeacher) {
            return sendError(res, 'You do not have access to this submission.', 403);
        }

        const paper = await QuestionPaperModel.findById(submission.paper_id);

        const student = {
            name: submission.student_name, register_no: submission.roll_no || 'N/A',
            department: submission.department, semester: String(submission.semester), subject: submission.subject
        };
        const teacher = {
            name: submission.teacher_name, subject: submission.subject,
            max_marks: Math.round(parseFloat(submission.max_marks) || 0)
        };
        const questions = paper.questions.map(q => ({
            id: q.ai_question_id, text: q.text, topic: q.topic, max_marks: parseFloat(q.max_marks),
            group_id: q.group_id || null, group_required: q.group_required != null ? q.group_required : null
        }));
        const results = submission.question_results.map(r => r.full_result);

        const { buffer, filename } = await aiBridge.generateReportPdf(student, teacher, questions, results, submission.overall_report);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /submissions/:id/questions/:resultId/flag
 * Flags a specific question result for human review (feeds the AI
 * engine's calibration feedback loop).
 * Access: Private
 */
const flagQuestionResult = async (req, res, next) => {
    try {
        const { id, resultId } = req.params;
        const { reason } = req.body;

        const submission = await SubmissionModel.findById(id);
        if (!submission) return sendError(res, 'Submission not found', 404);
        const target = submission.question_results.find(r => String(r.result_id) === String(resultId));
        if (!target) return sendError(res, 'Question result not found', 404);

        const flagId = await aiBridge.flagForReview(
            { id: target.question_id, text: target.question_text, topic: '', max_marks: target.question_max_marks },
            target.full_result,
            reason || 'Flagged by user for review.',
            req.user.email
        );
        return sendSuccess(res, 'Flagged for teacher review', { flag_id: flagId });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createSubmission,
    startEvaluationJob,
    getEvaluationJobStatus,
    finalizeSubmission,
    markSubmissionFailed,
    getSubmissionById,
    getSubmissions,
    overrideSubmission,
    overrideQuestionResult,
    downloadReport,
    flagQuestionResult
};
