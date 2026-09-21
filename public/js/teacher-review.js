/**
 * teacher-review.html logic: paper -> submission picker, renders the
 * OCR'd answers + AI evaluation for review, lets the teacher override
 * the overall score/add comments (Approve) or flag every question for
 * re-review (feeds the AI engine's calibration feedback loop).
 */
let currentSubmission = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('reviewPaperSelect')) return; // not this page
    loadTeacherPapers();
    wireControls();

    const params = new URLSearchParams(window.location.search);
    const preselectSubmission = params.get('submission_id');
    if (preselectSubmission) {
        loadSubmission(preselectSubmission);
    }
});

async function loadTeacherPapers() {
    const select = document.getElementById('reviewPaperSelect');
    try {
        const res = await TwinEvalApp.apiFetch('/papers?mine=true');
        const papers = res.data || [];
        if (!papers.length) {
            select.innerHTML = `<option value="">No papers created yet</option>`;
            return;
        }
        select.innerHTML = `<option value="">-- Choose a paper --</option>` +
            papers.map(p => `<option value="${p.paper_id}">${p.title} (${p.submission_count} submission${p.submission_count === 1 ? '' : 's'})</option>`).join('');

        select.addEventListener('change', () => loadSubmissionsForPaper(select.value));
    } catch (err) {
        select.innerHTML = `<option value="">Could not load papers</option>`;
        TwinEvalApp.showToast('Load Failed', err.message, 'danger');
    }
}

async function loadSubmissionsForPaper(paperId) {
    const select = document.getElementById('reviewSubmissionSelect');
    if (!paperId) {
        select.innerHTML = `<option value="">Select a paper first</option>`;
        return;
    }
    select.innerHTML = `<option value="">Loading...</option>`;
    try {
        const res = await TwinEvalApp.apiFetch(`/submissions?paper_id=${paperId}`);
        const subs = res.data || [];
        if (!subs.length) {
            select.innerHTML = `<option value="">No submissions yet for this paper</option>`;
            return;
        }
        select.innerHTML = `<option value="">-- Choose a submission --</option>` +
            subs.map(s => {
                if (s.status === 'failed') {
                    const reason = s.error_message ? ` -- ${s.error_message}` : '';
                    return `<option value="${s.submission_id}">⚠️ ${s.student_name} (${s.roll_no || 'no roll no'}) -- FAILED${reason}</option>`;
                }
                return `<option value="${s.submission_id}">${s.student_name} (${s.roll_no || 'no roll no'}) -- ${s.total_marks}/${s.max_marks}${s.status === 'reviewed' ? ' [reviewed]' : ''}</option>`;
            }).join('');

        select.addEventListener('change', () => { if (select.value) loadSubmission(select.value); });
    } catch (err) {
        select.innerHTML = `<option value="">Could not load submissions</option>`;
        TwinEvalApp.showToast('Load Failed', err.message, 'danger');
    }
}

async function loadSubmission(submissionId) {
    try {
        const res = await TwinEvalApp.apiFetch(`/submissions/${submissionId}`);
        currentSubmission = res.data;
        renderSubmission(currentSubmission);
        document.getElementById('reviewWorkspace').style.display = 'grid';
        document.getElementById('reviewEmptyState').style.display = 'none';
    } catch (err) {
        TwinEvalApp.showToast('Load Failed', err.message || 'Could not load this submission.', 'danger');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function renderSubmission(s) {
    document.getElementById('reviewStudentBadge').innerHTML =
        `<i class="fa-solid fa-user"></i> ${escapeHtml(s.student_name)} (${escapeHtml(s.roll_no || 'no roll no')})`;

    const results = s.question_results || [];
    document.getElementById('reviewAnswerSheets').innerHTML = results.map((r, i) => {
        const full = r.full_result || {};
        return `
            <div class="paper-sheet">
                <div class="paper-question-tag">Q${i + 1}. ${escapeHtml(r.question_text)} [${r.max_marks} Marks]</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                    [Extracted Student Answer]: AI awarded ${r.marks}/${r.max_marks} -- ${escapeHtml(full.feedback || '')}
                </div>
                <div class="ocr-extracted-text">${escapeHtml(r.student_answer || '(no answer detected)')}</div>
            </div>
        `;
    }).join('') || '<p style="color:var(--text-muted);">No per-question results available.</p>';

    const maxMarks = parseFloat(s.max_marks) || 0;
    const aiMarks = parseFloat(s.total_marks) || 0;
    const currentOverride = s.teacher_override_marks != null ? parseFloat(s.teacher_override_marks) : aiMarks;

    document.getElementById('reviewAiScoreBadge').innerHTML =
        `<i class="fa-solid fa-circle-check"></i> AI Score: ${Math.round(parseFloat(s.percentage) || 0)}%`;
    document.getElementById('reviewAiScore').textContent = `${aiMarks} / ${maxMarks}`;
    document.getElementById('reviewAiConfidence').textContent = `Grade ${s.grade || '-'} -- ${s.pass_fail || ''}`;

    const slider = document.getElementById('teacherScoreSlider');
    slider.min = 0;
    slider.max = maxMarks;
    slider.step = 0.25;
    slider.value = currentOverride;
    updateTeacherScoreDisplay(currentOverride, maxMarks);

    document.getElementById('teacherComments').value = s.teacher_comments || '';
}

function updateTeacherScoreDisplay(value, maxMarks) {
    document.getElementById('teacherScoreDisplay').textContent = `${value} / ${maxMarks}`;
    document.getElementById('finalCalculatedScore').textContent =
        maxMarks ? `${Math.round((value / maxMarks) * 100)}%` : '--';
}

function wireControls() {
    const slider = document.getElementById('teacherScoreSlider');
    slider.addEventListener('input', () => {
        if (!currentSubmission) return;
        updateTeacherScoreDisplay(parseFloat(slider.value), parseFloat(currentSubmission.max_marks) || 0);
    });

    document.getElementById('approveSubmissionBtn').addEventListener('click', async () => {
        if (!currentSubmission) return;
        const btn = document.getElementById('approveSubmissionBtn');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...`;
        btn.disabled = true;

        try {
            await TwinEvalApp.apiFetch(`/submissions/${currentSubmission.submission_id}/override`, {
                method: 'PUT',
                body: JSON.stringify({
                    teacher_override_marks: parseFloat(slider.value),
                    teacher_comments: document.getElementById('teacherComments').value
                })
            });
            TwinEvalApp.showToast('Review Saved', 'The final score has been approved and saved.', 'success');
            loadSubmission(currentSubmission.submission_id);
        } catch (err) {
            TwinEvalApp.showToast('Save Failed', err.message || 'Something went wrong.', 'danger');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });

    document.getElementById('rejectSubmissionBtn').addEventListener('click', async () => {
        if (!currentSubmission) return;
        const btn = document.getElementById('rejectSubmissionBtn');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Flagging...`;
        btn.disabled = true;

        try {
            const results = currentSubmission.question_results || [];
            await Promise.all(results.map(r =>
                TwinEvalApp.apiFetch(`/submissions/${currentSubmission.submission_id}/questions/${r.result_id}/flag`, {
                    method: 'POST',
                    body: JSON.stringify({ reason: 'Teacher requested re-review of the AI evaluation.' })
                })
            ));
            TwinEvalApp.showToast('Flagged for Review', 'All questions in this submission were sent to the AI review queue.', 'info');
        } catch (err) {
            TwinEvalApp.showToast('Flagging Failed', err.message || 'Something went wrong.', 'danger');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });
}
