/**
 * aiBridgeService: Node-side HTTP client for the Python AI engine
 * (ai-engine/ai_server.py). This is the ONLY place in the Node backend
 * that talks to the AI engine -- controllers call these functions
 * rather than making HTTP calls directly, so the integration point is
 * easy to find/change/mock later.
 */
const axios = require('axios');
const FormData = require('form-data');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// OCR + LLM grading can genuinely take a while (multi-page handwritten
// answer sheets, several questions each needing an LLM call) -- a
// short default axios timeout would abort a legitimate long-running
// evaluation, so this is set generously rather than tightly.
const client = axios.create({ baseURL: AI_SERVICE_URL, timeout: 10 * 60 * 1000 });

function unwrapError(error, fallbackMessage) {
    if (error.response) {
        const data = error.response.data;
        // Normal case: the AI engine returned proper JSON with a message.
        if (data && typeof data === 'object' && data.message) {
            const err = new Error(data.message);
            err.statusCode = error.response.status;
            return err;
        }
        // The AI engine returned something that ISN'T the expected JSON
        // shape (e.g. a raw HTML error page from an unhandled crash, or
        // an empty body) -- this used to be silently swallowed down to
        // a generic "X failed." message with zero diagnostic value.
        // Surface the actual HTTP status and a snippet of whatever body
        // did come back instead of hiding it.
        const snippet = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
        const err = new Error(
            `${fallbackMessage || 'AI engine request failed.'} (HTTP ${error.response.status}${snippet ? ': ' + snippet : ''})`
        );
        err.statusCode = error.response.status;
        return err;
    }
    if (error.code === 'ECONNREFUSED') {
        const err = new Error('Could not reach the AI engine. Make sure ai-engine/ai_server.py is running (see README).');
        err.statusCode = 503;
        return err;
    }
    // No HTTP response at all -- a network-level failure (timeout,
    // connection reset, DNS, etc). error.message here is the actual
    // low-level diagnostic (e.g. "timeout of 600000ms exceeded",
    // "socket hang up") and matters more than the generic fallback, so
    // include both rather than hiding the real one.
    const err = new Error(`${fallbackMessage || 'AI engine request failed.'} (${error.message})`);
    err.statusCode = 500;
    return err;
}

/**
 * Starts a background paper-generation job on the AI engine (OCR if a
 * file is given, split into questions, generate an AI answer key per
 * question) and returns immediately with a job id to poll -- see
 * getJobStatus. Either pass a file (fileBuffer + filename) OR rawText,
 * not both.
 */
async function createGenerationJob({ fileBuffer, filename, rawText, topic, defaultMaxMarks }) {
    try {
        const form = new FormData();
        if (fileBuffer) {
            form.append('file', fileBuffer, filename);
        } else {
            form.append('raw_text', rawText || '');
        }
        form.append('topic', topic || '');
        form.append('default_max_marks', String(defaultMaxMarks || 10));

        const { data } = await client.post('/jobs/generate-paper', form, { headers: form.getHeaders() });
        return data.job_id;
    } catch (error) {
        throw unwrapError(error, 'Could not start answer-key generation.');
    }
}

/**
 * Returns the current status of a generation job:
 * { done, error, stage, current, total, message, result }
 * `result` is only populated once `done` is true and `error` is null:
 * { questions: [...], answer_keys: {...} }
 */
async function getJobStatus(jobId) {
    try {
        const { data } = await client.get(`/jobs/${jobId}`);
        return data.job;
    } catch (error) {
        throw unwrapError(error, 'Could not check generation progress.');
    }
}

/**
 * Starts a background submission-evaluation job on the AI engine (OCR
 * the answer sheet, split into per-question answers, evaluate each
 * one) and returns immediately with a job id to poll via getJobStatus
 * -- the exact same job-polling mechanism as createGenerationJob, for
 * the same reason: a single long blocking request covering OCR + N
 * evaluation calls is fragile against normal network hiccups/timeouts.
 */
async function createSubmissionEvaluationJob({ fileBuffer, filename, questions, answerKeys, passPercentage }) {
    try {
        const form = new FormData();
        form.append('file', fileBuffer, filename);
        form.append('questions', JSON.stringify(questions));
        form.append('answer_keys', JSON.stringify(answerKeys));
        form.append('pass_percentage', String(passPercentage || 40.0));

        const { data } = await client.post('/jobs/evaluate-submission', form, { headers: form.getHeaders() });
        return data.job_id;
    } catch (error) {
        throw unwrapError(error, 'Could not start answer sheet evaluation.');
    }
}

async function checkHealth() {
    const { data } = await client.get('/health');
    return data;
}

/**
 * fileBuffer: Buffer (from multer's in-memory storage)
 * filename: original filename (extension determines OCR handling)
 */
async function extractText(fileBuffer, filename) {
    try {
        const form = new FormData();
        form.append('file', fileBuffer, filename);
        const { data } = await client.post('/extract-text', form, { headers: form.getHeaders() });
        return data.text;
    } catch (error) {
        throw unwrapError(error, 'Text extraction failed.');
    }
}

async function splitQuestions(rawText, topic, defaultMaxMarks) {
    try {
        const { data } = await client.post('/split-questions', {
            raw_text: rawText, topic, default_max_marks: defaultMaxMarks
        });
        return data.questions; // [{id, text, topic, max_marks, ...}]
    } catch (error) {
        throw unwrapError(error, 'Splitting the question paper into questions failed.');
    }
}

async function generateAnswerKeys(questions) {
    try {
        const { data } = await client.post('/generate-answer-keys', { questions });
        return data.answer_keys; // {question_id: AnswerKey dict}
    } catch (error) {
        throw unwrapError(error, 'AI answer-key generation failed.');
    }
}

async function splitAnswers(rawText, questions) {
    try {
        const { data } = await client.post('/split-answers', { raw_text: rawText, questions });
        return data.answers; // {question_id: answer_text}
    } catch (error) {
        throw unwrapError(error, 'Splitting the student answer sheet failed.');
    }
}

async function evaluate(questions, answerKeys, studentAnswers, passPercentage) {
    try {
        const { data } = await client.post('/evaluate', {
            questions, answer_keys: answerKeys, student_answers: studentAnswers, pass_percentage: passPercentage
        });
        return { results: data.results, overall: data.overall };
    } catch (error) {
        throw unwrapError(error, 'AI evaluation failed.');
    }
}

/**
 * Returns { buffer, filename } for the generated PDF report.
 */
async function generateReportPdf(student, teacher, questions, results, overall) {
    try {
        const { data, headers } = await client.post(
            '/generate-report-pdf',
            { student, teacher, questions, results, overall },
            { responseType: 'arraybuffer' }
        );
        const disposition = headers['content-disposition'] || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        return { buffer: Buffer.from(data), filename: match ? match[1] : 'evaluation_report.pdf' };
    } catch (error) {
        throw unwrapError(error, 'PDF report generation failed.');
    }
}

async function flagForReview(question, result, reason, flaggedBy) {
    try {
        const { data } = await client.post('/flags', { question, result, reason, flagged_by: flaggedBy });
        return data.flag_id;
    } catch (error) {
        throw unwrapError(error, 'Could not flag this result for review.');
    }
}

async function resolveFlag(flagId, teacherMarks, teacherReason) {
    try {
        await client.post(`/flags/${flagId}/resolve`, { teacher_marks: teacherMarks, teacher_reason: teacherReason });
    } catch (error) {
        throw unwrapError(error, 'Could not resolve this flag.');
    }
}

module.exports = {
    checkHealth,
    extractText,
    splitQuestions,
    generateAnswerKeys,
    splitAnswers,
    evaluate,
    generateReportPdf,
    flagForReview,
    resolveFlag,
    createGenerationJob,
    getJobStatus,
    createSubmissionEvaluationJob,
};
