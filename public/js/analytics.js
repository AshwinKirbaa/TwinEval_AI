/** Live analytics derived from the logged-in student's real submissions. */
document.addEventListener('DOMContentLoaded', () => StudentAnalytics.init());

const StudentAnalytics = {
  submissions: [],
  details: [],

  async init() {
    const root = document.getElementById('studentAnalyticsContent');
    if (!root) return;
    try {
      const response = await TwinEvalApp.apiFetch('/submissions');
      this.submissions = (Array.isArray(response.data) ? response.data : [])
        .filter(item => ['evaluated', 'reviewed'].includes(String(item.status || '').toLowerCase()));
      this.details = await Promise.all(this.submissions.map(async item => {
        try { return (await TwinEvalApp.apiFetch(`/submissions/${item.submission_id}`)).data; }
        catch (_) { return item; }
      }));
      this.render(root);
      if (!this.details.length) {
        document.getElementById('exportAnalyticsBtn')?.addEventListener('click', () => TwinEvalApp.showToast('No Data', 'Complete an evaluation first to export analytics.', 'info'));
      }
    } catch (error) {
      TwinEvalApp.showToast('Analytics Unavailable', error.message || 'Could not load your evaluations.', 'danger');
    }
  },

  finalPercentage(item) {
    const max = Number(item.max_marks) || 0;
    const marks = item.teacher_override_marks != null ? Number(item.teacher_override_marks) : Number(item.total_marks);
    return max ? Math.max(0, Math.min(100, marks / max * 100)) : Number(item.percentage) || 0;
  },

  analyze() {
    const scores = this.details.map(item => this.finalPercentage(item));
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const bloom = { Remember: [], Understand: [], Apply: [], Analyze: [], Evaluate: [], Create: [] };
    const concepts = new Map();
    const rubricScores = [];

    this.details.forEach(item => (item.question_results || []).forEach(row => {
      const full = row.full_result || {};
      const pct = Number(full.percentage ?? row.percentage) || 0;
      const level = Object.keys(bloom).find(key => key.toLowerCase() === String(full.bloom_level || '').toLowerCase());
      if (level) bloom[level].push(pct);
      rubricScores.push(pct);
      (full.found_concepts || []).forEach(name => this.recordConcept(concepts, name, true));
      (full.missing_concepts || []).forEach(name => this.recordConcept(concepts, name, false));
      (full.missing_keywords || []).forEach(name => this.recordConcept(concepts, name, false));
    }));

    const reviewed = this.details.filter(item => String(item.status).toLowerCase() === 'reviewed');
    const accuracyValues = reviewed.map(item => {
      const ai = Number(item.total_marks) || 0;
      const teacher = item.teacher_override_marks != null ? Number(item.teacher_override_marks) : ai;
      const max = Number(item.max_marks) || 1;
      return Math.max(0, 100 - Math.abs(teacher - ai) / max * 100);
    });
    const accuracy = accuracyValues.length ? accuracyValues.reduce((a, b) => a + b, 0) / accuracyValues.length : null;
    const rubric = rubricScores.length ? rubricScores.reduce((a, b) => a + b, 0) / rubricScores.length : average;
    const conceptRows = [...concepts.entries()].map(([name, value]) => ({ name, ...value, coverage: value.total ? value.found / value.total * 100 : 0 }));
    const strongest = conceptRows.filter(item => item.coverage >= 90).sort((a, b) => b.found - a.found).slice(0, 8);
    const review = conceptRows.filter(item => item.missing > 0).sort((a, b) => b.missing - a.missing).slice(0, 8);
    const bloomAverages = Object.fromEntries(Object.entries(bloom).map(([key, values]) => [key, values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0]));
    const dominantBloom = Object.entries(bloomAverages).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0];
    return { scores, average, rubric, accuracy, strongest, review, bloomAverages, dominantBloom };
  },

  recordConcept(map, rawName, found) {
    const name = String(rawName || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const row = map.get(key) || { name, found: 0, missing: 0, total: 0 };
    row[found ? 'found' : 'missing'] += 1;
    row.total += 1;
    map.set(key, row);
  },

  render(root) {
    if (!this.details.length) return; // retain the designed empty state
    const data = this.analyze();
    const gpa = Math.min(10, data.average / 10);
    root.innerHTML = `
      <div class="margin-bottom-lg" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;"><div><h1 style="font-size:1.65rem;font-weight:800;margin-bottom:.35rem;">Skill &amp; Mastery Analytics</h1><p style="color:var(--text-muted);font-size:.9rem;">Live insights from ${this.details.length} evaluated answer sheet${this.details.length === 1 ? '' : 's'}.</p></div><button type="button" class="btn btn-primary btn-md" id="exportAnalyticsBtn"><i class="fa-solid fa-file-export"></i> Export Report (CSV)</button></div>
      <div class="stats-grid">
        ${this.metric('fa-chart-simple','primary',gpa.toFixed(2),'Cumulative GPA',`${data.average.toFixed(1)}% average score`)}
        ${this.metric('fa-layer-group','accent',data.dominantBloom?.[0] || '—','Bloom Mastery',data.dominantBloom ? `${data.dominantBloom[1].toFixed(1)}% demonstrated` : 'Not classified')}
        ${this.metric('fa-circle-check','success',`${data.rubric.toFixed(1)}%`,'Rubric Compliance',`${this.details.reduce((n, s) => n + (s.question_results?.length || 0), 0)} questions analyzed`)}
        ${this.metric('fa-brain','warning',data.accuracy == null ? '—' : `${data.accuracy.toFixed(1)}%`,'AI Evaluator Accuracy',data.accuracy == null ? 'Awaiting teacher review' : 'Compared with teacher marks')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:1.5rem;margin-bottom:2rem;">
        <div class="glass-card padding-lg"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;"><div><h3 style="font-size:1.1rem;">Score Trend Over Semester</h3><p style="font-size:.82rem;color:var(--text-muted);">Evaluated answer sheets in chronological order</p></div><span class="badge badge-primary">${this.details.length} Results</span></div>${this.trendChart()}</div>
        <div class="glass-card padding-lg"><div style="text-align:center;margin-bottom:1rem;"><h3 style="font-size:1.1rem;">Bloom's Skill Mastery</h3><p style="font-size:.82rem;color:var(--text-muted);">Cognitive depth by evaluated questions</p></div>${this.bloomBars(data.bloomAverages)}</div>
      </div>`;
    document.getElementById('exportAnalyticsBtn')?.addEventListener('click', () => this.exportCsv());
  },

  metric(icon, color, value, label, detail) {
    return `<div class="glass-card stat-card"><div class="stat-icon ${color}"><i class="fa-solid ${icon}"></i></div><div><div class="stat-value">${this.escape(value)}</div><div class="stat-label">${this.escape(label)}</div><div class="stat-trend text-muted">${this.escape(detail)}</div></div></div>`;
  },

  trendChart() {
    const rows = [...this.details].reverse();
    const w = 760, h = 220, left = 42, bottom = 28;
    const points = rows.map((item, index) => {
      const x = left + index * ((w - left * 2) / Math.max(1, rows.length - 1));
      const score = this.finalPercentage(item);
      const y = 10 + (100 - score) / 100 * (h - bottom - 20);
      return { x, y, score, item };
    });
    const polyline = points.map(point => `${point.x},${point.y}`).join(' ');
    const nodes = points.map(point => `<a href="feedback.html?submission_id=${encodeURIComponent(point.item.submission_id)}"><circle cx="${point.x}" cy="${point.y}" r="6" fill="#ff7054"><title>${this.escape(point.item.paper_title)}: ${point.score.toFixed(1)}%</title></circle></a>`).join('');
    const labels = points.map(point => `<text x="${point.x}" y="214" text-anchor="middle">${this.escape(String(point.item.paper_title || 'Paper').slice(0, 12))}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:220px;"><g stroke="#e8e6eb" stroke-width="1"><line x1="${left}" y1="10" x2="${w-left}" y2="10"/><line x1="${left}" y1="101" x2="${w-left}" y2="101"/><line x1="${left}" y1="192" x2="${w-left}" y2="192"/></g><g fill="#aaa9b1" font-size="10"><text x="8" y="14">100</text><text x="15" y="105">50</text><text x="22" y="196">0</text>${labels}</g><polyline points="${polyline}" fill="none" stroke="#ff7054" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${nodes}</svg>`;
  },

  bloomBars(values) {
    return Object.entries(values).map(([name, value]) => `<div style="margin:.65rem 0;"><div style="display:flex;justify-content:space-between;font-size:.78rem;"><span>${name}</span><strong>${value ? `${value.toFixed(0)}%` : '—'}</strong></div><div style="height:8px;background:var(--bg-secondary);border-radius:99px;overflow:hidden;margin-top:.3rem;"><div style="height:100%;width:${value}%;background:var(--primary);border-radius:inherit;"></div></div></div>`).join('');
  },

  conceptCard(title, icon, color, background, rows, empty, strong) {
    const content = rows.length ? rows.map(item => `<a href="feedback.html" style="display:flex;justify-content:space-between;text-decoration:none;color:inherit;padding:.55rem 0;border-bottom:1px solid var(--border-subtle);"><span>${this.escape(item.name)}</span><strong style="color:${color};">${strong ? `${item.coverage.toFixed(0)}%` : `${item.missing} missed`}</strong></a>`).join('') : `<div style="color:var(--text-muted);text-align:center;padding:1.5rem 0;">${empty}</div>`;
    return `<div class="glass-card padding-lg" style="border-top:4px solid ${color};"><div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;"><div style="width:36px;height:36px;border-radius:50%;background:${background};color:${color};display:flex;align-items:center;justify-content:center;"><i class="fa-solid ${icon}"></i></div><h3 style="font-size:1.05rem;">${title}</h3></div>${content}</div>`;
  },

  exportCsv() {
    const header = ['Paper','Subject','Date','Status','Final Marks','Maximum Marks','Percentage'];
    const rows = this.details.map(item => [item.paper_title,item.subject,item.evaluated_at || item.submitted_at,item.status,item.teacher_override_marks ?? item.total_marks,item.max_marks,this.finalPercentage(item).toFixed(2)]);
    const csv = [header, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'TwinEval_Student_Analytics.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  },

  escape(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
};
