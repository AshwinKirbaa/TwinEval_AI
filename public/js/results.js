/**
 * TWINEVAL AI - RESULTS & FEEDBACK MODULE JAVASCRIPT
 */

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.results-page') || document.querySelector('.feedback-page')) {
    ResultsModule.init();
  }
});

const ResultsModule = {
  submission: null,

  async init() {
    this.initFeedbackTabs();

    const params = new URLSearchParams(window.location.search);
    const submissionId = params.get('submission_id');

    if (!submissionId || !document.getElementById('populatedResultsState')) {
      return; // stay on the empty state (already visible by default)
    }

    try {
      const res = await TwinEvalApp.apiFetch(`/submissions/${submissionId}`);
      this.submission = res.data;
      this.render(this.submission);
      this.initReportDownload(submissionId);

      document.getElementById('noResultsState').style.display = 'none';
      document.getElementById('populatedResultsState').style.display = 'flex';
    } catch (err) {
      TwinEvalApp.showToast('Could Not Load Results', err.message || 'Please try again.', 'danger');
      // fall back to the empty state, which is already showing
    }
  },

  render(s) {
    const overall = s.overall_report || {};
    const displayMarks = s.teacher_override_marks != null ? parseFloat(s.teacher_override_marks) : parseFloat(s.total_marks) || 0;
    const maxMarks = parseFloat(s.max_marks) || 0;
    const displayPercentage = maxMarks ? (displayMarks / maxMarks) * 100 : 0;
    const displayGrade = displayPercentage >= 90 ? 'A+' : displayPercentage >= 80 ? 'A' : displayPercentage >= 70 ? 'B+' : displayPercentage >= 60 ? 'B' : displayPercentage >= 50 ? 'C' : displayPercentage >= 40 ? 'D' : 'F';
    const passThreshold = parseFloat((overall.pass_percentage ?? s.pass_percentage)) || 40;
    const displayPass = displayPercentage >= passThreshold;

    document.getElementById('resultPaperTitle').textContent = s.paper_title || 'Evaluation Results';
    document.getElementById('resultPaperSubtitle').textContent =
      `${s.subject || ''} -- graded ${s.evaluated_at ? new Date(s.evaluated_at).toLocaleString() : ''}`;

    document.getElementById('resultPercentage').textContent = `${Math.round(displayPercentage)}%`;
    document.getElementById('resultGradeBadge').textContent = `Grade ${displayGrade}`;

    const passBadge = document.getElementById('resultPassFailBadge');
    const isPass = displayPass;
    passBadge.textContent = isPass ? 'Passed' : 'Failed';
    passBadge.className = isPass ? 'badge badge-success' : 'badge badge-danger';

    document.getElementById('resultMarksHeading').textContent = `${displayMarks} / ${s.max_marks} marks`;

    let studentLine = `${s.student_name || ''}${s.roll_no ? ' (' + s.roll_no + ')' : ''}`;
    if (s.status === 'reviewed') studentLine += ' -- reviewed by teacher';
    if (s.teacher_comments) studentLine += `: "${s.teacher_comments}"`;
    document.getElementById('resultStudentLine').textContent = studentLine;

    document.getElementById('resultStrengths').textContent =
      (overall.overall_strengths || []).join('; ') || 'No specific strengths noted.';
    document.getElementById('resultWeaknesses').textContent =
      (overall.overall_weaknesses || []).join('; ') || 'No specific weaknesses noted.';
    document.getElementById('resultTopicsToRevise').textContent =
      (overall.topics_to_revise || overall.frequently_missed_concepts || []).join(', ') || 'None identified.';

    const results = s.question_results || [];
    document.getElementById('resultQuestionCount').textContent = `${results.length} Question${results.length === 1 ? '' : 's'}`;

    document.getElementById('questionResultsList').innerHTML = results.map((r, i) => {
      const full = r.full_result || {};
      const flagBadge = full.needs_review
        ? `<span class="badge badge-warning" title="${this.escapeHtml(full.review_reason || '')}"><i class="fa-solid fa-triangle-exclamation"></i> Flagged for review</span>`
        : '';
      const offTopicBadge = full.is_off_topic
        ? `<span class="badge badge-danger"><i class="fa-solid fa-circle-exclamation"></i> Off-topic</span>` : '';
      // Reference's "answer any N of M" choice-group handling: an
      // attempted-but-extra question still shows its AI marks above,
      // but those marks don't count towards the overall total -- make
      // that visible instead of leaving it a silent discrepancy.
      const groupBadge = (full.group_note)
        ? `<span class="badge ${full.counted ? 'badge-primary' : 'badge-warning'}"><i class="fa-solid fa-layer-group"></i> ${this.escapeHtml(full.group_note)}</span>`
        : '';

      return `
        <div class="glass-card padding-md">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin-bottom:0.5rem;">
            <div style="font-weight:600;">Q${i + 1}. ${this.escapeHtml(r.question_text)}</div>
            <span class="badge badge-primary" style="flex-shrink:0;">${r.marks} / ${r.max_marks}</span>
          </div>
          <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem; flex-wrap:wrap;">${flagBadge}${offTopicBadge}${groupBadge}</div>
          ${full.group_id ? `<p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.5rem;">AI marks: ${r.marks} / ${r.max_marks} &nbsp;|&nbsp; Counted: ${full.counted ? (full.contributed_marks ?? r.marks) : 0} / ${full.contributed_max_marks ?? r.max_marks}</p>` : ''}
          <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem;">${this.escapeHtml(full.feedback || '')}</p>
          ${(full.missing_concepts && full.missing_concepts.length) ? `<p style="font-size:0.8rem;"><strong>Missing concepts:</strong> ${this.escapeHtml(full.missing_concepts.join(', '))}</p>` : ''}
          ${(full.suggestions && full.suggestions.length) ? `<p style="font-size:0.8rem;"><strong>Suggestions:</strong> ${this.escapeHtml(full.suggestions.join('; '))}</p>` : ''}
        </div>
      `;
    }).join('');
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  initReportDownload(submissionId) {
    const downloadBtn = document.getElementById('downloadReportBtn');
    if (!downloadBtn) return;

    downloadBtn.addEventListener('click', async () => {
      const originalHtml = downloadBtn.innerHTML;
      downloadBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Preparing report...`;
      downloadBtn.disabled = true;

      try {
        const s = this.submission;
        const questionResults = s.question_results || [];
        const blob = await TwinEvalLocalAI.generateReportPdf({
          student: {
            name: s.student_name || '',
            register_no: s.roll_no || 'N/A',
            department: s.department || '',
            semester: String(s.semester || ''),
            subject: s.subject || ''
          },
          teacher: {
            name: s.teacher_name || '',
            subject: s.subject || '',
            max_marks: Math.round(parseFloat(s.max_marks) || 0)
          },
          questions: questionResults.map((r, index) => ({
            id: String(r.full_result?.question_id || r.question_id || index + 1),
            text: r.question_text || '',
            topic: '',
            max_marks: parseFloat(r.question_max_marks || r.max_marks) || 0
          })),
          results: questionResults.map(r => ({
            ...(r.full_result || {}),
            question_text: r.question_text || r.full_result?.question_text || '',
            marks: parseFloat(r.teacher_override_marks ?? r.marks) || 0,
            max_marks: parseFloat(r.max_marks) || 0
          })),
          overall: s.overall_report || {}
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TwinEval_AI_Report_${submissionId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        TwinEvalApp.showToast('Report Downloaded', 'Evaluation report saved successfully.', 'success');
      } catch (err) {
        TwinEvalApp.showToast('Download Failed', err.message || 'Could not generate the report.', 'danger');
      } finally {
        downloadBtn.innerHTML = originalHtml;
        downloadBtn.disabled = false;
      }
    });
  },

  initFeedbackTabs() {
    const tabBtns = document.querySelectorAll('.question-tab-btn');
    const tabPanes = document.querySelectorAll('.feedback-tab-pane');

    if (tabBtns.length === 0) return;

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetQ = btn.getAttribute('data-target');

        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPane = document.getElementById(targetQ);
        if (targetPane) {
          targetPane.classList.add('active');
        }
      });
    });
  }
};
