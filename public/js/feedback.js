/** Student question-wise AI feedback and teacher review workspace. */
document.addEventListener('DOMContentLoaded', () => FeedbackModule.init());

const FeedbackModule = {
  submission: null,
  submissions: [],
  currentSubmissionId: null,

  async init() {
    const workspace = document.getElementById('feedbackWorkspace');
    if (!workspace) return;

    window.addEventListener('popstate', () => {
      const id = new URLSearchParams(window.location.search).get('submission_id');
      if (id && String(id) !== String(this.currentSubmissionId)) {
        this.loadSubmission(id);
      }
    });

    try {
      const listResponse = await TwinEvalApp.apiFetch('/submissions');
      const allSubmissions = Array.isArray(listResponse.data) ? listResponse.data : [];

      // Filter for completed submissions (teacher reviewed or AI evaluated)
      this.submissions = allSubmissions.filter(s => {
        const st = String(s.status || '').toLowerCase();
        return st === 'reviewed' || st === 'evaluated';
      });

      if (!this.submissions.length) {
        return;
      }

      let submissionId = new URLSearchParams(window.location.search).get('submission_id');
      const exists = this.submissions.find(s => String(s.submission_id) === String(submissionId));
      if (!exists) {
        // Prefer teacher-reviewed (verified) answer script first, then latest evaluated
        const preferred = this.submissions.find(s => String(s.status).toLowerCase() === 'reviewed') || this.submissions[0];
        submissionId = preferred.submission_id;
        const url = new URL(window.location.href);
        url.searchParams.set('submission_id', submissionId);
        window.history.replaceState(null, '', url.toString());
      }

      await this.loadSubmission(submissionId);
    } catch (error) {
      TwinEvalApp.showToast('Could Not Load Feedback', error.message || 'Please try again.', 'danger');
    }
  },

  async loadSubmission(submissionId) {
    const workspace = document.getElementById('feedbackWorkspace');
    if (!workspace) return;
    try {
      const response = await TwinEvalApp.apiFetch(`/submissions/${encodeURIComponent(submissionId)}`);
      this.submission = response.data;
      this.currentSubmissionId = submissionId;
      this.render(workspace, this.submission);
      this.bindTabs();
      this.bindSelector();
    } catch (error) {
      TwinEvalApp.showToast('Could Not Load Submission', error.message || 'Please try again.', 'danger');
    }
  },

  buildOptionsHtml(submissions, currentId) {
    const reviewed = submissions.filter(s => String(s.status || '').toLowerCase() === 'reviewed');
    const evaluated = submissions.filter(s => String(s.status || '').toLowerCase() !== 'reviewed');

    const renderOption = (s) => {
      const isReviewed = String(s.status || '').toLowerCase() === 'reviewed';
      const marks = s.teacher_override_marks ?? s.total_marks ?? 0;
      const maxMarks = s.max_marks || 0;
      const date = this.formatDate(s.evaluated_at || s.submitted_at);
      const title = s.paper_title || 'Answer Script';
      const subject = s.subject ? ` (${s.subject})` : '';
      const statusLabel = isReviewed ? 'Teacher Reviewed' : 'AI Evaluated';
      const selected = String(s.submission_id) === String(currentId) ? 'selected' : '';
      return `<option value="${this.escape(s.submission_id)}" ${selected}>${this.escape(title)}${this.escape(subject)} — ${marks}/${maxMarks} marks · ${statusLabel}${date ? ' · ' + date : ''}</option>`;
    };

    if (reviewed.length && evaluated.length) {
      return `
        <optgroup label="Teacher Verified Answer Scripts">
          ${reviewed.map(renderOption).join('')}
        </optgroup>
        <optgroup label="AI Evaluated Answer Scripts">
          ${evaluated.map(renderOption).join('')}
        </optgroup>
      `;
    }

    if (reviewed.length) {
      return `
        <optgroup label="Teacher Verified Answer Scripts">
          ${reviewed.map(renderOption).join('')}
        </optgroup>
      `;
    }

    return submissions.map(renderOption).join('');
  },

  buildSelectorHtml(currentId) {
    if (!this.submissions || !this.submissions.length) return '';

    const reviewedCount = this.submissions.filter(s => String(s.status || '').toLowerCase() === 'reviewed').length;
    const optionsHtml = this.buildOptionsHtml(this.submissions, currentId);

    return `
      <div class="glass-card padding-md" style="display:flex;align-items:center;justify-content:space-between;gap:1.25rem;flex-wrap:wrap;border-radius:16px;">
        <div style="display:flex;align-items:center;gap:0.85rem;flex:1;min-width:280px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,112,84,0.12);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex-shrink:0;">
            <i class="fa-solid fa-file-circle-check"></i>
          </div>
          <div style="flex:1;">
            <label for="feedbackSubmissionSelect" style="display:block;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:0.35rem;">
              Select Teacher Verified Answer Script
            </label>
            <select id="feedbackSubmissionSelect" class="form-input" style="width:100%;font-weight:600;font-size:0.9rem;padding:0.5rem 0.75rem;border-radius:10px;cursor:pointer;appearance:auto;background:var(--bg-secondary);border:1px solid var(--border-subtle);">
              ${optionsHtml}
            </select>
          </div>
        </div>
        ${reviewedCount > 0 ? `
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span class="badge badge-success" style="padding:0.45rem 0.8rem;font-size:0.8rem;">
              <i class="fa-solid fa-check-double"></i> ${reviewedCount} Verified Script${reviewedCount === 1 ? '' : 's'} Available
            </span>
          </div>
        ` : ''}
      </div>
    `;
  },

  bindSelector() {
    const select = document.getElementById('feedbackSubmissionSelect');
    if (!select) return;
    select.addEventListener('change', async (e) => {
      const selectedId = e.target.value;
      if (!selectedId || selectedId === String(this.currentSubmissionId)) return;

      const url = new URL(window.location.href);
      url.searchParams.set('submission_id', selectedId);
      window.history.pushState(null, '', url.toString());

      await this.loadSubmission(selectedId);
    });
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

      ${this.buildSelectorHtml(s.submission_id)}

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

  formatDate(val) {
    if (!val) return '';
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
};
