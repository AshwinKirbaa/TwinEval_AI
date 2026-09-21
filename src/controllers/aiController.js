const { evaluateStudentPerformance, generatePersonalizedLearningPlan } = require('../services/aiService');
const StudentModel = require('../models/studentModel');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * POST /ai/evaluate
 * AI Student Evaluation API
 */
const evaluateStudent = async (req, res, next) => {
    try {
        const { marks, attendance, communication, problem_solving } = req.body;

        const analysis = evaluateStudentPerformance(marks, attendance, communication, problem_solving);

        return sendSuccess(res, 'AI student performance evaluation generated successfully', analysis);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /ai/learning-plan
 * AI Personalized Learning Plan Generation API
 */
const generateLearningPlan = async (req, res, next) => {
    try {
        const { student_id, subject, weak_topics } = req.body;

        let targetSubject = subject || 'General Engineering';
        let targetWeakTopics = weak_topics || [];

        // If student_id is provided, pull student department details
        if (student_id) {
            const student = await StudentModel.findById(student_id);
            if (student) {
                targetSubject = student.department;
            }
        }

        const plan = generatePersonalizedLearningPlan({
            subject: targetSubject,
            weak_topics: targetWeakTopics
        });

        return sendSuccess(res, 'Personalized AI learning plan generated successfully', plan);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    evaluateStudent,
    generateLearningPlan
};
