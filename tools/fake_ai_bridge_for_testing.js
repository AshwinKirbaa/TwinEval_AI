// TEMP TEST-ONLY fake AI bridge -- mimics ai-engine/ai_server.py's
// response shapes so the Node backend's full flow (paper creation,
// submission, evaluation, DB persistence) can be exercised end-to-end
// without needing a real Ollama install in this sandbox.
const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ success: true, ollama_ready: true, message: 'fake ready' }));

app.post('/extract-text', (req, res) => {
    res.json({ success: true, text: '1. Explain the OSI model.\nThe OSI model has 7 layers used for networking.\n\n2. What is normalization?\nNormalization reduces redundancy in databases by organizing data efficiently.' });
});

app.post('/split-questions', (req, res) => {
    const { default_max_marks, topic } = req.body;
    res.json({
        success: true,
        questions: [
            { id: 'q1fake', text: 'Explain the OSI model.', topic: topic || '', max_marks: default_max_marks || 10, source: 'manual', group_id: null, group_required: null },
            { id: 'q2fake', text: 'What is normalization?', topic: topic || '', max_marks: default_max_marks || 10, source: 'manual', group_id: null, group_required: null },
        ]
    });
});

app.post('/generate-answer-keys', (req, res) => {
    const { questions } = req.body;
    const keys = {};
    questions.forEach(q => {
        keys[q.id] = {
            question_id: q.id, model_answer: `Model answer for: ${q.text}`,
            keywords: ['keyword1', 'keyword2'], concepts: ['concept1'], expected_points: ['point1'],
            advantages: [], disadvantages: [], applications: [], steps: [], formulae: [], diagrams: [],
            bloom_level: 'Understand', rubric: { concept_coverage: q.max_marks }
        };
    });
    res.json({ success: true, answer_keys: keys });
});

app.post('/split-answers', (req, res) => {
    const { questions } = req.body;
    const answers = {};
    questions.forEach((q, i) => { answers[q.id] = `Fake student answer text for question ${i + 1}.`; });
    res.json({ success: true, answers });
});

app.post('/evaluate', (req, res) => {
    const { questions, pass_percentage } = req.body;
    const results = questions.map(q => ({
        question_id: q.id, question_text: q.text, max_marks: q.max_marks,
        student_answer: 'Fake student answer text.', is_off_topic: false,
        marks: q.max_marks * 0.75, percentage: 75.0, grade: 'B+',
        marks_breakdown: { concept_coverage: q.max_marks * 0.75 },
        found_concepts: ['concept1'], missing_concepts: [], missing_keywords: [], missing_points: [], missing_diagrams: [],
        strengths: ['Good coverage'], improvements: [], suggestions: [], confidence: 88.0, bloom_level: 'Understand',
        evidence_map: { concept_coverage: 'mentions the key idea' }, needs_review: false, review_reason: '',
        topic_relevance: { is_relevant: true, relevance_score: 0.9, reason: 'on topic' },
        feedback: 'Very good answer with strong coverage of the topic.'
    }));
    const totalMarks = results.reduce((s, r) => s + r.marks, 0);
    const maxMarks = results.reduce((s, r) => s + r.max_marks, 0);
    const percentage = Math.round((totalMarks / maxMarks) * 1000) / 10;
    res.json({
        success: true, results,
        overall: {
            total_marks: totalMarks, max_marks: maxMarks, percentage, grade: 'B+',
            pass_fail: percentage >= pass_percentage ? 'Pass' : 'Fail',
            overall_strengths: ['Good coverage'], overall_weaknesses: [], frequently_missed_concepts: [],
            topics_to_revise: [], recommendations: [], study_suggestions: []
        }
    });
});

app.post('/generate-report-pdf', (req, res) => {
    // Minimal valid-enough PDF bytes for a download test
    const fakePdf = Buffer.from('%PDF-1.4\n%FAKE\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="fake_report.pdf"');
    res.send(fakePdf);
});

app.get('/flags', (req, res) => res.json({ success: true, flags: [] }));
app.post('/flags', (req, res) => res.json({ success: true, flag_id: 'fake-flag-1' }));
app.post('/flags/:id/resolve', (req, res) => res.json({ success: true }));

app.listen(8000, () => console.log('Fake AI bridge listening on :8000'));
