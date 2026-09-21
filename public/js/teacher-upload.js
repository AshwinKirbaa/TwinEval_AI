/**
 * teacher-upload.html logic: create a question paper (manual text or
 * uploaded file), start a background AI generation job, poll it for
 * live progress (mirrors exactly what the AI engine is doing --
 * extracting text, splitting questions, generating each answer key),
 * then finalize (persist) and publish. Talks to the real /papers API
 * via TwinEvalApp.apiFetch (see js/script.js).
 */
let questionInputMode = 'manual';
let generatedPaper = null;   // full paper object returned by /papers/finalize
let pendingPaperMeta = null; // title/subject/topic/pass_percentage held while a job runs
let pollTimer = null;

function setQuestionInputMode(mode) {
    questionInputMode = mode;
    document.getElementById('manualInputPanel').hidden = mode !== 'manual';
    document.getElementById('uploadInputPanel').hidden = mode !== 'upload';
    document.getElementById('modeManualBtn').classList.toggle('active', mode === 'manual');
    document.getElementById('modeUploadBtn').classList.toggle('active', mode === 'upload');
}

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('qpFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const label = document.getElementById('qpFileLabel');
            if (fileInput.files[0]) {
                label.textContent = `Selected: ${fileInput.files[0].name}`;
            }
        });
    }
});

// Human-readable labels for each stage the AI engine reports -- shown
// above the live message so it's obvious what phase generation is in.
const STAGE_LABELS = {
    queued: 'Queued',
    extracting_text: 'Reading Question Paper (OCR)',
    splitting_questions: 'Splitting Into Questions',
    generating_keys: 'Generating AI Answer Keys',
    complete: 'Done',
};

async function generateQuestionPaper() {
    const title = document.getElementById('paperTitle').value.trim();
    const subject = document.getElementById('paperSubject').value.trim();
    const topic = document.getElementById('paperTopic').value.trim();
    const defaultMaxMarks = document.getElementById('defaultMaxMarks').value;
    const passPercentage = document.getElementById('passPercentage').value;

    if (!title || !subject) {
        TwinEvalApp.showToast('Missing Fields', 'Title and Subject are required.', 'danger');
        return;
    }

    const formData = new FormData();
    formData.append('topic', topic);
    formData.append('default_max_marks', defaultMaxMarks);

    if (questionInputMode === 'manual') {
        const rawText = document.getElementById('manualQuestionText').value.trim();
        if (!rawText) {
            TwinEvalApp.showToast('No Questions', 'Type at least one question first.', 'danger');
            return;
        }
        formData.append('raw_text', rawText);
    } else {
        const file = document.getElementById('qpFileInput').files[0];
        if (!file) {
            TwinEvalApp.showToast('No File', 'Please choose a question paper file to upload.', 'danger');
            return;
        }
        formData.append('file', file);
    }

    pendingPaperMeta = { title, subject, topic, pass_percentage: passPercentage };

    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    showProgressCard();
    updateProgress({ stage: 'queued', message: 'Starting...', current: 0, total: 0 });

    try {
        const ai = await TwinEvalLocalAI.startJob('/jobs/generate-paper', formData);
        pollJob(ai.job_id);
    } catch (err) {
        onGenerationFailed(err.message || 'Could not start generation.');
    }
}

// A single transient network hiccup (Wi-Fi blip, a momentarily busy
// server, etc) during any one of the many polls over a long generation
// run must NOT throw away a job that's still completing successfully
// in the background. Only give up after several CONSECUTIVE failures.
const MAX_CONSECUTIVE_POLL_FAILURES = 6;
let consecutivePollFailures = 0;
let jobStartedAt = null;

function pollJob(jobId) {
    clearTimeout(pollTimer);
    consecutivePollFailures = 0;
    jobStartedAt = Date.now();

    const tick = async () => {
        try {
            const jobResponse = await TwinEvalLocalAI.getJob(jobId);
            const job = jobResponse.job;
            consecutivePollFailures = 0; // any successful poll resets the failure counter
            updateProgress(job);

            if (!job.done) {
                pollTimer = setTimeout(tick, 900);
                return;
            }

            if (job.error) {
                onGenerationFailed(job.error);
                return;
            }

            await finalizeAndPublishPreview(job.result);
        } catch (err) {
            consecutivePollFailures += 1;
            if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                onGenerationFailed(
                    (err.message || 'Lost connection while checking progress.') +
                    ' (Generation is running on this computer -- check the local AI engine before retrying.)'
                );
                return;
            }
            // Transient failure -- back off a bit and keep trying rather
            // than aborting a job that's likely still fine server-side.
            document.getElementById('progressMessageText').textContent =
                `Connection hiccup, retrying... (${consecutivePollFailures}/${MAX_CONSECUTIVE_POLL_FAILURES})`;
            pollTimer = setTimeout(tick, 1500);
        }
    };

    tick();
}

function updateProgress(job) {
    document.getElementById('progressStageLabel').textContent = STAGE_LABELS[job.stage] || 'Working...';

    let message = job.message || '';
    if (jobStartedAt && job.stage !== 'complete') {
        const elapsedSec = Math.round((Date.now() - jobStartedAt) / 1000);
        if (elapsedSec >= 60) {
            const mins = Math.floor(elapsedSec / 60);
            const secs = elapsedSec % 60;
            message += ` (${mins}m ${secs}s elapsed -- local AI generation, this is expected to take a while for larger papers)`;
        }
    }
    document.getElementById('progressMessageText').textContent = message;

    const countEl = document.getElementById('progressCount');
    const fillEl = document.getElementById('progressFill');
    if (job.total > 0) {
        countEl.textContent = `${job.current} / ${job.total}`;
        fillEl.style.width = `${Math.round((job.current / job.total) * 100)}%`;
    } else {
        countEl.textContent = '';
        fillEl.style.width = job.stage === 'complete' ? '100%' : '8%';
    }
}

function showProgressCard() {
    document.getElementById('generationProgressCard').hidden = false;
    document.getElementById('generationProgressCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onGenerationFailed(message) {
    clearTimeout(pollTimer);
    document.getElementById('generationProgressCard').hidden = true;
    document.getElementById('generateBtn').disabled = false;
    TwinEvalApp.showToast('Generation Failed', message, 'danger');
}

async function finalizeAndPublishPreview(result) {
    try {
        const payload = Object.assign({}, pendingPaperMeta, {
            questions: result.questions,
            answer_keys: result.answer_keys,
        });
        const res = await TwinEvalApp.apiFetch('/papers/finalize', { method: 'POST', body: JSON.stringify(payload) });
        generatedPaper = res.data;

        document.getElementById('generationProgressCard').hidden = true;
        document.getElementById('generateBtn').disabled = false;

        renderPreview(generatedPaper);
        TwinEvalApp.showToast('Answer Key Generated', `${generatedPaper.questions.length} question(s) with AI answer keys ready for review.`, 'success');
        document.getElementById('previewSection').hidden = false;
        document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        onGenerationFailed(err.message || 'Could not save the generated paper.');
    }
}

function renderPreview(paper) {
    const container = document.getElementById('questionsPreview');
    container.innerHTML = paper.questions.map((q, i) => {
        const key = q.answer_key || {};
        const rubricChips = Object.entries(key.rubric || {})
            .map(([criterion, marks]) => `<span class="badge">${escapeHtml(criterion)}: ${marks}</span>`)
            .join('');
        return `
            <div class="glass-card padding-md question-preview-card">
                <div class="question-preview-header">
                    <div class="question-preview-text">Q${i + 1}. ${escapeHtml(q.text)}</div>
                    <span class="badge badge-accent" style="flex-shrink:0;">${q.max_marks} marks</span>
                </div>
                <p class="text-muted" style="font-size:0.82rem;"><strong>Model Answer:</strong> ${escapeHtml(key.model_answer || '(not generated)')}</p>
                <div class="rubric-chip-row">${rubricChips || '<span class="text-muted">No rubric generated.</span>'}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

async function publishGeneratedPaper() {
    if (!generatedPaper) return;
    const btn = document.getElementById('publishBtn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Publishing...`;
    btn.disabled = true;

    try {
        await TwinEvalApp.apiFetch(`/papers/${generatedPaper.paper_id}/publish`, { method: 'PATCH' });
        TwinEvalApp.showToast('Paper Published', 'Students can now submit answers to this paper.', 'success');
        setTimeout(() => { window.location.href = 'teacher-dashboard.html'; }, 1200);
    } catch (err) {
        TwinEvalApp.showToast('Publish Failed', err.message || 'Something went wrong.', 'danger');
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}
