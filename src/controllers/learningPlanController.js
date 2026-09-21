const LearningPlanModel = require('../models/learningPlanModel');
const StudentModel = require('../models/studentModel');
const { generatePersonalizedLearningPlan } = require('../services/aiService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * GET /plans
 * Get all learning plans
 */
const getPlans = async (req, res, next) => {
    try {
        const plans = await LearningPlanModel.findAll();
        return sendSuccess(res, 'Learning plans retrieved successfully', plans);
    } catch (error) {
        next(error);
    }
};

/**
 * GET /plans/:id
 * Get single learning plan by ID
 */
const getPlanById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const plan = await LearningPlanModel.findById(id);

        if (!plan) {
            return sendError(res, 'Learning plan not found', 404);
        }

        return sendSuccess(res, 'Learning plan retrieved successfully', plan);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /plans
 * Create/generate a new learning plan for a student
 */
const createPlan = async (req, res, next) => {
    try {
        const { student_id, weak_topics, recommended_resources, practice_tasks, study_schedule } = req.body;

        // Verify student exists
        const student = await StudentModel.findById(student_id);
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        let planData = {
            weak_topics,
            recommended_resources,
            practice_tasks,
            study_schedule
        };

        // Auto-generate if components are omitted
        if (!weak_topics || !recommended_resources || !practice_tasks) {
            const aiGenerated = generatePersonalizedLearningPlan({
                subject: student.department,
                weak_topics: weak_topics || []
            });
            planData = {
                weak_topics: weak_topics || aiGenerated.weak_topics,
                recommended_resources: recommended_resources || aiGenerated.recommended_resources,
                practice_tasks: practice_tasks || aiGenerated.practice_tasks,
                study_schedule: study_schedule || aiGenerated.study_schedule
            };
        }

        const planId = await LearningPlanModel.create({
            student_id,
            ...planData
        });

        const createdPlan = await LearningPlanModel.findById(planId);
        return sendSuccess(res, 'Learning plan created successfully', createdPlan, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /plans/:id
 * Update existing learning plan
 */
const updatePlan = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { weak_topics, recommended_resources, practice_tasks, study_schedule } = req.body;

        const existing = await LearningPlanModel.findById(id);
        if (!existing) {
            return sendError(res, 'Learning plan not found', 404);
        }

        await LearningPlanModel.update(id, {
            weak_topics: weak_topics || existing.weak_topics,
            recommended_resources: recommended_resources || existing.recommended_resources,
            practice_tasks: practice_tasks || existing.practice_tasks,
            study_schedule: study_schedule || existing.study_schedule
        });

        const updated = await LearningPlanModel.findById(id);
        return sendSuccess(res, 'Learning plan updated successfully', updated);
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /plans/:id
 * Delete learning plan
 */
const deletePlan = async (req, res, next) => {
    try {
        const { id } = req.params;
        const existing = await LearningPlanModel.findById(id);

        if (!existing) {
            return sendError(res, 'Learning plan not found', 404);
        }

        await LearningPlanModel.delete(id);
        return sendSuccess(res, 'Learning plan deleted successfully', { plan_id: parseInt(id) });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getPlans,
    getPlanById,
    createPlan,
    updatePlan,
    deletePlan
};
