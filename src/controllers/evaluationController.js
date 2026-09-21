const EvaluationModel = require('../models/evaluationModel');
const StudentModel = require('../models/studentModel');
const { evaluateStudentPerformance } = require('../services/aiService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * GET /evaluations
 * List evaluation results
 */
const getEvaluations = async (req, res, next) => {
    try {
        const { student_id, subject, limit } = req.query;
        const evaluations = await EvaluationModel.findAll({ student_id, subject, limit });
        return sendSuccess(res, 'Evaluations retrieved successfully', evaluations);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /evaluations/:id
 * Get single evaluation result
 */
const getEvaluationById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const evaluation = await EvaluationModel.findById(id);

        if (!evaluation) {
            return sendError(res, 'Evaluation record not found', 404);
        }

        return sendSuccess(res, 'Evaluation record retrieved successfully', evaluation);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /evaluations
 * Create evaluation and automatically calculate AI Score
 */
const createEvaluation = async (req, res, next) => {
    try {
        const { student_id, subject, marks, attendance, communication, problem_solving, remarks } = req.body;

        // Verify student exists
        const student = await StudentModel.findById(student_id);
        if (!student) {
            return sendError(res, 'Student not found with provided student_id', 404);
        }

        // Calculate AI Score via AI Engine Service
        const aiResult = evaluateStudentPerformance(marks, attendance, communication, problem_solving);

        // Save evaluation
        const evalId = await EvaluationModel.create({
            student_id,
            subject,
            marks,
            attendance,
            communication,
            problem_solving,
            ai_score: aiResult.ai_score,
            remarks: remarks || aiResult.suggestions.join(' ')
        });

        const createdEvaluation = await EvaluationModel.findById(evalId);

        return sendSuccess(res, 'Evaluation record created and AI score calculated successfully', {
            evaluation: createdEvaluation,
            ai_analysis: aiResult
        }, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /evaluations/:id
 * Update evaluation record
 */
const updateEvaluation = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { subject, marks, attendance, communication, problem_solving, remarks } = req.body;

        const existing = await EvaluationModel.findById(id);
        if (!existing) {
            return sendError(res, 'Evaluation record not found', 404);
        }

        // Recalculate AI score
        const aiResult = evaluateStudentPerformance(
            marks !== undefined ? marks : existing.marks,
            attendance !== undefined ? attendance : existing.attendance,
            communication !== undefined ? communication : existing.communication,
            problem_solving !== undefined ? problem_solving : existing.problem_solving
        );

        await EvaluationModel.update(id, {
            subject: subject || existing.subject,
            marks: marks !== undefined ? marks : existing.marks,
            attendance: attendance !== undefined ? attendance : existing.attendance,
            communication: communication !== undefined ? communication : existing.communication,
            problem_solving: problem_solving !== undefined ? problem_solving : existing.problem_solving,
            ai_score: aiResult.ai_score,
            remarks: remarks !== undefined ? remarks : existing.remarks
        });

        const updated = await EvaluationModel.findById(id);
        return sendSuccess(res, 'Evaluation record updated successfully', {
            evaluation: updated,
            ai_analysis: aiResult
        });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /evaluations/:id
 * Delete evaluation record
 */
const deleteEvaluation = async (req, res, next) => {
    try {
        const { id } = req.params;
        const existing = await EvaluationModel.findById(id);

        if (!existing) {
            return sendError(res, 'Evaluation record not found', 404);
        }

        await EvaluationModel.delete(id);
        return sendSuccess(res, 'Evaluation record deleted successfully', { evaluation_id: parseInt(id) });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getEvaluations,
    getEvaluationById,
    createEvaluation,
    updateEvaluation,
    deleteEvaluation
};
