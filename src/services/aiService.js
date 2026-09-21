/**
 * TwinEval AI Service Module
 * Provides intelligent evaluation heuristics, grade calculations, 
 * feedback analysis, and automated personalized learning plans.
 */

/**
 * Calculate multi-factor AI Performance Score, Grade, Strengths, Weaknesses, and Suggestions
 * @param {number} marks - Exam marks (0-100)
 * @param {number} attendance - Attendance rate percentage (0-100)
 * @param {number} communication - Communication skill score (0-100)
 * @param {number} problemSolving - Problem solving capability score (0-100)
 */
function evaluateStudentPerformance(marks, attendance, communication, problemSolving) {
    const m = parseFloat(marks);
    const a = parseFloat(attendance);
    const c = parseFloat(communication);
    const p = parseFloat(problemSolving);

    // Weighted Formula: Marks (40%), Problem Solving (25%), Attendance (20%), Communication (15%)
    const rawAiScore = (m * 0.40) + (p * 0.25) + (a * 0.20) + (c * 0.15);
    const aiScore = parseFloat(rawAiScore.toFixed(2));

    // Determine Performance Grade
    let grade = 'F';
    if (aiScore >= 90) grade = 'A+';
    else if (aiScore >= 80) grade = 'A';
    else if (aiScore >= 70) grade = 'B';
    else if (aiScore >= 60) grade = 'C';
    else if (aiScore >= 50) grade = 'D';

    // Identify Strengths and Weaknesses
    const metrics = [
        { name: 'Academic Marks', score: m, metric: 'marks' },
        { name: 'Class Attendance', score: a, metric: 'attendance' },
        { name: 'Communication Skills', score: c, metric: 'communication' },
        { name: 'Problem Solving Ability', score: p, metric: 'problem_solving' }
    ];

    // Sort metrics descending to pick top and bottom factors
    const sorted = [...metrics].sort((x, y) => y.score - x.score);

    const strengths = sorted
        .filter(item => item.score >= 75)
        .map(item => `High competency in ${item.name} (${item.score}%)`);

    if (strengths.length === 0) {
        strengths.push(`Demonstrates foundation in ${sorted[0].name} (${sorted[0].score}%)`);
    }

    const weaknesses = sorted
        .filter(item => item.score < 75)
        .map(item => `Needs enhancement in ${item.name} (${item.score}%)`);

    if (weaknesses.length === 0) {
        weaknesses.push('No critical weakness detected; maintain current performance level.');
    }

    // Generate Targeted Actionable Suggestions
    const suggestions = [];
    if (m < 75) {
        suggestions.push('Review core textbook chapters and solve past exam questions daily.');
    }
    if (a < 80) {
        suggestions.push('Improve classroom attendance to avoid missing key conceptual lectures.');
    }
    if (c < 75) {
        suggestions.push('Participate in group discussions, presentations, and technical seminars.');
    }
    if (p < 75) {
        suggestions.push('Practice algorithmic problem solving on platforms like LeetCode and HackerRank.');
    }
    if (suggestions.length === 0) {
        suggestions.push('Excellent overall balanced score! Focus on peer mentoring and advanced projects.');
    }

    return {
        ai_score: aiScore,
        performance_grade: grade,
        strengths,
        weaknesses,
        suggestions
    };
}

/**
 * Generate a personalized learning plan based on evaluation metrics or custom inputs
 * @param {Object} input - Contains subject, weak_topics or low scoring areas
 */
function generatePersonalizedLearningPlan(input) {
    const subject = input.subject || 'General Engineering & Computing';
    const weakTopicsInput = input.weak_topics || [];

    let weakTopics = [];
    if (Array.isArray(weakTopicsInput) && weakTopicsInput.length > 0) {
        weakTopics = weakTopicsInput;
    } else {
        weakTopics = [
            `Advanced Concepts in ${subject}`,
            'Problem-Solving & System Design',
            'Practical Implementation & Debugging'
        ];
    }

    const recommendedResources = [
        `NPTEL / Coursera Specialization for ${subject}`,
        `MIT OpenCourseWare Reference Material on ${weakTopics[0] || subject}`,
        'Official Documentation & W3Schools / GeeksforGeeks Guides',
        'YouTube Tech Lectures & Code Walkthroughs'
    ];

    const practiceTasks = [
        `Complete 5 practical exercises focused on ${weakTopics[0] || 'core topics'}.`,
        'Build a mini-project applying key concepts learned this semester.',
        'Solve 10 previous year question papers under timed conditions.',
        'Present a technical summary of weak topics to a peer or instructor.'
    ];

    const studySchedule = {
        week1: `Focus on fundamentals of ${weakTopics[0] || 'core subjects'} and theoretical review.`,
        week2: `Hands-on practice exercises and solving assignments for ${weakTopics[1] || 'practical topics'}.`,
        week3: 'Mini-project development and real-world application building.',
        week4: 'Mock tests, peer review, and final evaluation revision.'
    };

    return {
        weak_topics: weakTopics,
        recommended_resources: recommendedResources,
        practice_tasks: practiceTasks,
        study_schedule: studySchedule
    };
}

module.exports = {
    evaluateStudentPerformance,
    generatePersonalizedLearningPlan
};
