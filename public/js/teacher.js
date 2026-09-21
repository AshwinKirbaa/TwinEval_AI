/**
 * TWINEVAL AI - TEACHER MODULE JAVASCRIPT
 */

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('teacher-page') || document.querySelector('.teacher-dashboard') || document.querySelector('.review-workspace')) {
    TeacherModule.init();
  }
});

const TeacherModule = {
  allSubmissions: [],
  searchActive: false,

  init() {
    this.initRubricMatrixBuilder();
    this.loadLiveTeacherData();
  },

  async loadLiveTeacherData() {
    const isDashboard = !!document.getElementById('teacherRecentSubmissionsBody');
    const isAnalytics = !!document.getElementById('analyticsMeanValue');
    if (!isDashboard && !isAnalytics) return;

    try {
      const papersRes = await TwinEvalApp.apiFetch('/papers?mine=true');
      const papers = papersRes.data || [];
      const submissionLists = await Promise.all(
        papers.map(async paper => {
          try {
            const res = await TwinEvalApp.apiFetch(`/submissions?paper_id=${encodeURIComponent(paper.paper_id)}`);
            return (res.data || []).map(s => ({ ...s, paper_title: paper.title, paper_subject: paper.subject }));
          } catch (e) {
            return [];
          }
        })
      );
      const submissions = submissionLists.flat();

      if (isDashboard) this.renderDashboardData(papers, submissions);
      if (isAnalytics) await this.renderAnalyticsData(submissions);
    } catch (err) {
      if (isDashboard) {
        const body = document.getElementById('teacherRecentSubmissionsBody');
        if (body) body.innerHTML = `<tr><td colspan="5" style="padding:1.25rem;text-align:center;color:var(--text-muted);">Could not load live submissions.</td></tr>`;
      }
      if (isAnalytics) TwinEvalApp.showToast('Analytics Unavailable', err.message || 'Could not load live analytics.', 'warning');
    }
  },

  renderDashboardData(papers, submissions) {
    const evaluated = submissions.filter(s => s.status === 'evaluated' || s.status === 'reviewed');
    const pending = submissions.filter(s => s.status === 'evaluated');
    const reviewed = submissions.filter(s => s.status === 'reviewed');
    const overridden = submissions.filter(s => s.teacher_override_marks != null);
    const mean = evaluated.length
      ? evaluated.reduce((sum, s) => sum + (parseFloat(s.percentage) || 0), 0) / evaluated.length
      : null;
    const overrideRate = submissions.length ? (overridden.length / submissions.length) * 100 : null;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('pendingReviewsValue', pending.length);
    setText('approvedEvaluationsValue', reviewed.length);
    setText('classMeanValue', mean == null ? '--' : `${mean.toFixed(1)}%`);
    setText('overrideRateValue', overrideRate == null ? '--' : `${overrideRate.toFixed(1)}%`);
    setText('classMeanContext', evaluated.length ? `${evaluated.length} evaluated submission${evaluated.length === 1 ? '' : 's'}` : 'No evaluated submissions yet');
    setText('overrideRateContext', submissions.length ? `${overridden.length} teacher override${overridden.length === 1 ? '' : 's'}` : 'No submissions yet');
    setText('teacherDashboardSummary', `You have ${pending.length} submission${pending.length === 1 ? '' : 's'} pending review and ${reviewed.length} reviewed submission${reviewed.length === 1 ? '' : 's'}.`);

    const reviewBtn = document.getElementById('startReviewBtn');
    if (reviewBtn) reviewBtn.innerHTML = `<i class="fa-solid fa-glasses"></i> ${pending.length ? `Review ${pending.length} Pending` : 'Review Workspace'}`;

    const body = document.getElementById('teacherRecentSubmissionsBody');
    if (body) {
      this.allSubmissions = submissions;
      this.renderSubmissionRows([...submissions].sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)).slice(0, 5));
      this.initSubmissionSearch();
    }

    if (document.getElementById('classPerformanceChart')) {
      const grouped = papers.map(p => {
        const rows = evaluated.filter(s => String(s.paper_id) === String(p.paper_id));
        return { title: p.title, mean: rows.length ? rows.reduce((sum, s) => sum + (parseFloat(s.percentage) || 0), 0) / rows.length : 0, count: rows.length };
      }).filter(x => x.count > 0).slice(0, 8);
      if (grouped.length) {
        TwinEvalApp.Charts.createBarChart('classPerformanceChart', grouped.map(x => x.title.length > 18 ? `${x.title.slice(0,18)}…` : x.title), grouped.map(x => Number(x.mean.toFixed(1))), '#2563eb');
      } else {
        document.getElementById('classPerformanceChart').innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No evaluated submissions to chart.</div>';
      }
    }
  },

  renderSubmissionRows(list) {
    const body = document.getElementById('teacherRecentSubmissionsBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="5" style="padding:1.25rem;text-align:center;color:var(--text-muted);">${this.searchActive ? 'No submissions match your search.' : 'No submissions yet.'}</td></tr>`;
      return;
    }
    body.innerHTML = list.map(s => {
      const score = s.status === 'failed' ? '--' : `${s.total_marks ?? 0} / ${s.max_marks ?? 0}`;
      const status = s.status === 'reviewed'
        ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Reviewed</span>`
        : s.status === 'evaluated'
          ? `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> Pending Review</span>`
          : s.status === 'failed'
            ? `<span class="badge badge-danger"><i class="fa-solid fa-circle-exclamation"></i> Failed</span>`
            : `<span class="badge"><i class="fa-solid fa-spinner"></i> Processing</span>`;
      const action = s.status === 'failed' ? 'View' : 'Review';
      return `<tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:1rem;"><div style="font-weight:600;color:var(--text-main);">${this.escapeHtml(s.student_name || 'Student')}</div><div style="font-size:.75rem;color:var(--text-muted);">${this.escapeHtml(s.roll_no || 'No roll number')}</div></td>
        <td style="padding:1rem;font-size:.85rem;">${this.escapeHtml(s.paper_subject || s.subject || '—')}</td>
        <td style="padding:1rem;"><span style="font-weight:700;color:var(--primary);font-size:1.05rem;">${this.escapeHtml(String(score))}</span></td>
        <td style="padding:1rem;">${status}</td>
        <td style="padding:1rem;text-align:right;"><a href="teacher-review.html?submission_id=${encodeURIComponent(s.submission_id)}" class="btn btn-sm ${s.status === 'reviewed' ? 'btn-secondary' : 'btn-primary'}">${action}</a></td>
      </tr>`;
    }).join('');
  },

  /**
   * The dashboard table only ever shows the 5 MOST RECENT submissions
   * by default -- searching must look across every submission the
   * teacher has, not just those 5 already-rendered rows, or it would
   * silently fail to find the vast majority of their students.
   */
  initSubmissionSearch() {
    const input = document.getElementById('teacherSubmissionSearchInput');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      this.searchActive = !!q;
      if (!q) {
        this.renderSubmissionRows([...this.allSubmissions].sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)).slice(0, 5));
        return;
      }
      const filtered = this.allSubmissions.filter(s =>
        [s.student_name, s.roll_no, s.paper_subject, s.subject, s.paper_title].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
      );
      this.renderSubmissionRows(filtered);
    });
  },

  async renderAnalyticsData(submissions) {
    const evaluated = submissions.filter(s => s.status === 'evaluated' || s.status === 'reviewed');
    const mean = evaluated.length ? evaluated.reduce((sum, s) => sum + (parseFloat(s.percentage) || 0), 0) / evaluated.length : null;
    const topCount = evaluated.filter(s => (parseFloat(s.percentage) || 0) >= 90).length;
    const consensus = evaluated.length ? (evaluated.filter(s => s.teacher_override_marks == null).length / evaluated.length) * 100 : null;
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('analyticsMeanValue', mean == null ? '--' : `${mean.toFixed(1)}%`);
    setText('analyticsConsensusValue', consensus == null ? '--' : `${consensus.toFixed(1)}%`);
    setText('analyticsTopCountValue', topCount);

    const details = [];
    for (const s of evaluated) {
      try {
        const res = await TwinEvalApp.apiFetch(`/submissions/${s.submission_id}`);
        (res.data.question_results || []).forEach(q => details.push({
          paper: s.paper_title || s.subject || 'Paper',
          text: q.question_text || 'Question',
          percentage: parseFloat(q.percentage) || 0,
          full: q.full_result || {}
        }));
      } catch (e) { /* keep analytics usable even if one detail request fails */ }
    }

    if (details.length) {
      const hardest = [...details].sort((a, b) => a.percentage - b.percentage)[0];
      setText('analyticsHardestValue', hardest.text.length > 16 ? `${hardest.text.slice(0,16)}…` : hardest.text);
      setText('analyticsHardestContext', `Lowest average observed score: ${hardest.percentage.toFixed(1)}%`);
    }

    if (document.getElementById('gradeDistributionChart')) {
      const grades = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];
      const counts = grades.map(g => evaluated.filter(s => s.grade === g).length);
      TwinEvalApp.Charts.createBarChart('gradeDistributionChart', grades, counts, '#06b6d4');
    }

    if (document.getElementById('classBloomRadar')) {
      const levels = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
      const sums = Object.fromEntries(levels.map(l => [l, 0]));
      const counts = Object.fromEntries(levels.map(l => [l, 0]));
      details.forEach(d => {
        const level = d.full.bloom_level;
        if (sums[level] !== undefined) { sums[level] += d.percentage; counts[level] += 1; }
      });
      const scores = levels.map(l => counts[l] ? Number((sums[l] / counts[l]).toFixed(1)) : 0);
      if (counts[levels[0]] || counts[levels[1]] || counts[levels[2]] || counts[levels[3]] || counts[levels[4]] || counts[levels[5]]) {
        TwinEvalApp.Charts.createRadarChart('classBloomRadar', levels, scores);
      } else {
        document.getElementById('classBloomRadar').innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No Bloom data yet.</div>';
      }
    }
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  },

  initRubricMatrixBuilder() {
    const addCriterionBtn = document.getElementById('addCriterionBtn');
    const rubricContainer = document.getElementById('rubricCriteriaContainer');

    if (!addCriterionBtn || !rubricContainer) return;

    let criterionCount = 2;

    addCriterionBtn.addEventListener('click', () => {
      criterionCount++;
      const item = document.createElement('div');
      item.className = 'glass-card padding-md margin-bottom-sm animate-fade-in';
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <div style="font-weight: 600; color: var(--primary);">Criterion ${criterionCount}</div>
          <button class="btn btn-sm btn-ghost remove-criterion-btn" style="color: var(--danger);"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="form-grid" style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem;">
          <input type="text" class="form-input" placeholder="e.g. Code Efficiency & Complexity" required>
          <input type="number" class="form-input" placeholder="Marks (e.g. 10)" max="50" required>
        </div>
      `;

      rubricContainer.appendChild(item);

      item.querySelector('.remove-criterion-btn').addEventListener('click', () => {
        item.remove();
        TwinEvalApp.showToast('Criterion Removed', 'Rubric matrix updated.', 'info');
      });

      TwinEvalApp.showToast('Criterion Added', 'New grading standard appended to rubric matrix.', 'success');
    });
  }
};
