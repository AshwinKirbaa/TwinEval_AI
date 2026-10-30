/** Student question-wise AI feedback and teacher review workspace. */
document.addEventListener('DOMContentLoaded', () => FeedbackModule.init());

const FeedbackModule = {
  submission: null,

  async init() {
    const workspace = document.getElementById('feedbackWorkspace');
    if (!workspace) return;

    try {
      let submissionId = new URLSearchParams(window.location.search).get('submission_id');
      if (!submissionId) {
        const listResponse = await TwinEvalApp.apiFetch('/submissions');
        const submissions = Array.isArray(listResponse.data) ? listResponse.data : [];
        const selected = submissions.find(s => String(s.status).toLowerCase() === 'reviewed')
          || submissions.find(s => String(s.status).toLowerCase() === 'evaluated');
        if (!selected) return;
        submissionId = selected.submission_id;
        history.replaceState(null, '', `feedback.html?submission_id=${encodeURIComponent(submissionId)}`);
      }

      const response = await TwinEvalApp.apiFetch(`/submissions/${encodeURIComponent(submissionId)}`);
      this.submission = response.data;
      this.render(workspace, this.submission);
      this.bindTabs();
    } catch (error) {
      TwinEvalApp.showToast('Could Not Load Feedback', error.message || 'Please try again.', 'danger');
    }
  },

  render(workspace, s) {
    const rows = s.question_results || [];
    const reviewed = String(s.status || '').toLowerCase() === 'reviewed';
    const total = s.teacher_override_marks ?? s.total_marks ?? 0;
    const scriptUrl = s.answer_file_path ? TwinEvalApp.resolveUploadUrl(s.answer_file_path) : '';

    const tabs = rows.map((_, i) => `<button type="button" class="question-tab-btn ${i === 0 ? 'active' : ''}" data-feedback-index="${i}" style="border:0;border-radius:999px;padding:.55rem .9rem;white-space:nowrap;cursor:pointer;background:${i === 0 ? 'var(--primary)' : 'var(--bg-secondary)'};color:${i === 0 ? '#fff' : 'var(--text-muted)'};font-weight:700;">Q${i + 1}</button>`).join('');
    const panes = rows.map((row, i) => this.questionPane(row, i)).join('');

    workspace.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;">
        <div><h1 style="font-size:1.65rem;font-weight:800;margin-bottom:.35rem;">Question Feedback Workspace</h1><p style="color:var(--text-muted);font-size:.9rem;">AI analysis and the teacher's final review for this answer script.</p></div>
        <a href="results.html?submission_id=${encodeURIComponent(s.submission_id)}" class="btn btn-outline btn-md"><i class="fa-solid fa-arrow-left"></i> Back to Score Summary</a>
      </div>

      <div class="glass-card padding-lg">
        <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:center;">
          <div><span class="badge ${reviewed ? 'badge-success' : 'badge-primary'}"><i class="fa-solid ${reviewed ? 'fa-user-check' : 'fa-robot'}"></i> ${reviewed ? 'Teacher Reviewed' : 'AI Evaluated'}</span><h2 style="font-size:1.15rem;margin:.65rem 0 .25rem;">${this.escape(s.paper_title || 'Evaluation')}</h2><p style="color:var(--text-muted);font-size:.84rem;">${this.escape(s.subject || '')} · ${this.escape(s.teacher_name || 'Teacher')} · ${this.escape(s.student_name || '')}</p></div>
          <div style="text-align:right;"><strong style="font-size:1.35rem;">${this.escape(total)} / ${this.escape(s.max_marks || 0)}</strong><div style="color:var(--text-muted);font-size:.78rem;">Final marks</div></div>
        </div>
        ${reviewed ? `<div style="margin-top:1rem;padding:1rem;border-radius:12px;background:#f2fbf6;border:1px solid #bde8cf;"><strong><i class="fa-solid fa-chalkboard-user"></i> Teacher comments</strong><p style="margin:.4rem 0 0;color:var(--text-muted);">${this.escape(s.teacher_comments || 'Reviewed with no additional comment.')}</p></div>` : `<div style="margin-top:1rem;padding:.85rem 1rem;border-radius:12px;background:var(--bg-secondary);color:var(--text-muted);font-size:.83rem;">Teacher review has not been submitted yet. The AI feedback below is available now.</div>`}
        ${scriptUrl ? `<a href="${this.escape(scriptUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-md" style="margin-top:1rem;"><i class="fa-solid fa-file-arrow-up"></i> View Submitted Answer Script</a>` : ''}
      </div>

      <div class="glass-card padding-lg">
        <div id="feedbackQuestionTabs" style="display:flex;gap:.5rem;overflow-x:auto;padding-bottom:.8rem;border-bottom:1px solid var(--border-subtle);margin-bottom:1.25rem;">${tabs || '<span style="color:var(--text-muted);">No question results found.</span>'}</div>
        <div id="feedbackQuestionPanes">${panes}</div>
      </div>`;
  },

  questionPane(row, index) {
    const full = row.full_result || {};
    const found = full.found_concepts || [];
    const missing = full.missing_concepts || [];
    const coverage = found.length + missing.length ? Math.round(found.length / (found.length + missing.length) * 100) : 0;
    const finalMark = row.teacher_override_marks ?? row.marks ?? 0;
    const teacherChanged = row.teacher_override_marks != null;
    const rubric = full.rubric_scores || full.criterion_scores || {};
    const rubricHtml = Object.keys(rubric).length
      ? Object.entries(rubric).map(([key, value]) => `<div style="display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0;border-bottom:1px solid var(--border-subtle);"><span>${this.escape(key.replaceAll('_', ' '))}</span><strong>${this.escape(typeof value === 'object' ? JSON.stringify(value) : value)}</strong></div>`).join('')
      : '<span style="color:var(--text-muted);">Included in the final AI judgment.</span>';

    return `<section class="feedback-question-pane" data-feedback-pane="${index}" style="display:${index === 0 ? 'block' : 'none'};">
      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(230px,1fr);gap:1.5rem;">
        <div>
          <h3 style="font-size:1rem;margin-bottom:.8rem;">Q${index + 1}. ${this.escape(row.question_text || '')}</h3>
          <div style="padding:1rem;background:var(--bg-secondary);border-radius:12px;margin-bottom:1rem;"><strong>Student answer</strong><p style="margin:.5rem 0 0;white-space:pre-wrap;color:var(--text-muted);">${this.escape(row.student_answer || full.student_answer || 'No answer captured.')}</p></div>
          <h4 style="margin-bottom:.4rem;">AI feedback</h4><p style="color:var(--text-muted);margin-bottom:1rem;">${this.escape(full.feedback || 'No written feedback available.')}</p>
          ${this.listBlock('Strengths', full.strengths)}
          ${this.listBlock('Areas to improve', full.improvements || full.weaknesses)}
          ${this.listBlock('Suggestions', full.suggestions)}
          ${this.listBlock('Missing concepts', missing)}
        </div>
        <aside style="display:flex;flex-direction:column;gap:1rem;">
          <div class="glass-card padding-md"><h4>Final question mark</h4><div style="font-size:1.55rem;font-weight:800;color:var(--primary);margin:.5rem 0;">${this.escape(finalMark)} / ${this.escape(row.max_marks || row.question_max_marks || 0)}</div><small style="color:var(--text-muted);">${teacherChanged ? `Teacher changed the AI mark from ${this.escape(row.marks)}.` : 'AI mark retained by the teacher.'}</small></div>
          <div class="glass-card padding-md"><h4>Concept Coverage</h4><div style="font-size:1.55rem;font-weight:800;margin:.5rem 0;">${coverage}%</div><small style="color:var(--text-muted);">${found.length} found · ${missing.length} missing</small></div>
          <div class="glass-card padding-md"><h4>Bloom's Cognitive Level</h4><div style="font-weight:700;margin-top:.55rem;">${this.escape(full.bloom_level || 'Not classified')}</div></div>
          <div class="glass-card padding-md"><h4 style="margin-bottom:.5rem;">Rubric Compliance</h4><div style="font-size:.78rem;text-transform:capitalize;">${rubricHtml}</div></div>
        </aside>
      </div>
    </section>`;
  },

  listBlock(title, items) {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!values.length) return '';
    return `<div style="margin-bottom:1rem;"><strong>${this.escape(title)}</strong><ul style="margin:.45rem 0 0 1.1rem;color:var(--text-muted);">${values.map(value => `<li>${this.escape(value)}</li>`).join('')}</ul></div>`;
  },

  bindTabs() {
    document.querySelectorAll('[data-feedback-index]').forEach(button => button.addEventListener('click', () => {
      const index = button.dataset.feedbackIndex;
      document.querySelectorAll('[data-feedback-index]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.style.background = active ? 'var(--primary)' : 'var(--bg-secondary)';
        item.style.color = active ? '#fff' : 'var(--text-muted)';
      });
      document.querySelectorAll('[data-feedback-pane]').forEach(pane => { pane.style.display = pane.dataset.feedbackPane === index ? 'block' : 'none'; });
    }));
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
};
