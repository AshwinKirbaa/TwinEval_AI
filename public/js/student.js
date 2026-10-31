/** TwinEval AI - live student dashboard */
document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('student-page')) return;
  StudentModule.init();
});

const StudentModule = {
  submissions: [],
  papers: [],
  searchActive: false,
  searchQuery: '',
  statusFilter: 'all',
  init() {
    this.loadDashboard();
    this.initDashboardFilters();
    this.initCalendar();
  },

  async loadDashboard() {
    try {
      const [subRes, paperRes] = await Promise.all([
        TwinEvalApp.apiFetch('/submissions'),
        TwinEvalApp.apiFetch('/papers')
      ]);
      this.submissions = Array.isArray(subRes.data) ? subRes.data : [];
      this.papers = Array.isArray(paperRes.data) ? paperRes.data : [];
      this.renderStats();
      this.renderPerformance();
      this.applyDashboardFilters();
      this.renderProgress();
      this.renderPapers();
      this.markCalendarDates();
    } catch (err) {
      console.error('Dashboard data error:', err);
      this.renderStats();
    }
  },

  evaluated() { return this.submissions.filter(s => ['evaluated', 'reviewed'].includes(String(s.status || '').toLowerCase())); },
  pending() { return this.submissions.filter(s => ['processing', 'pending'].includes(String(s.status || '').toLowerCase())); },

  renderStats() {
    const done = this.evaluated();
    const pending = this.pending();
    const scores = done.map(s => Number(s.percentage)).filter(Number.isFinite);
    const avg = scores.length ? scores.reduce((a,b) => a+b,0)/scores.length : null;
    const high = scores.length ? Math.max(...scores) : null;
    this.text('statEvaluated', done.length);
    this.text('statAverage', avg == null ? '—' : `${avg.toFixed(1)}%`);
    this.text('statHigh', high == null ? '—' : `${high.toFixed(1)}%`);
    this.text('statPending', pending.length);
  },

  renderPerformance() {
    const el = document.getElementById('performanceChart');
    if (!el) return;
    const rows = this.evaluated().slice(0, 7).reverse();
    if (!rows.length) {
      el.innerHTML = '<div class="chart-empty"><i class="fa-solid fa-chart-line"></i><span>No evaluations yet</span><small>Upload an answer sheet to start.</small></div>';
      return;
    }
    const w=760,h=205,padX=34,padY=22;
    const max=100, min=0;
    const points=rows.map((s,i)=>{
      const x=padX+(i*Math.max(1,(w-padX*2)/(Math.max(1,rows.length-1))));
      const v=Math.max(0,Math.min(max,Number(s.percentage)||0));
      const y=h-padY-(v/max)*(h-padY*2);
      return [x,y,v,s];
    });
    const line=points.map(p=>`${p[0]},${p[1]}`).join(' ');
    const circles=points.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#ff7054"/><circle cx="${p[0]}" cy="${p[1]}" r="7" fill="none" stroke="#ff7054" stroke-opacity=".15" stroke-width="5"/>`).join('');
    const labels=points.map(p=>`<text x="${p[0]}" y="193" text-anchor="middle">${this.escape(this.shortPaper(p[3].paper_title))}</text>`).join('');
    el.innerHTML=`<svg class="performance-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="34" y1="22" x2="726" y2="22" stroke="#eeeeF0"/><line x1="34" y1="74" x2="726" y2="74" stroke="#eeeeF0"/><line x1="34" y1="126" x2="726" y2="126" stroke="#eeeeF0"/><line x1="34" y1="178" x2="726" y2="178" stroke="#eeeeF0"/><polyline points="${line}" fill="none" stroke="#ff7054" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${circles}<g fill="#aaa9b1" font-size="9">${labels}</g><g fill="#b3b1b8" font-size="9"><text x="7" y="26">100</text><text x="13" y="78">75</text><text x="13" y="130">50</text><text x="13" y="182">25</text></g></svg>`;
  },

  renderRecent(list) {
    const el=document.getElementById('recentEvaluations'); if(!el) return;
    const rows = list || this.submissions.slice(0,5);
    if(!rows.length){
      el.innerHTML = (this.searchActive || this.statusFilter !== 'all')
        ? '<div class="list-empty"><i class="fa-solid fa-filter"></i><strong>No matches</strong><span>No evaluations match the selected filters.</span></div>'
        : '<div class="list-empty"><i class="fa-regular fa-file-lines"></i><strong>No evaluations yet</strong><span>Your completed evaluations will appear here.</span></div>';
      return;
    }
    el.innerHTML=rows.map(s=>{
      const status=String(s.status||'').toLowerCase();
      const done=['evaluated','reviewed'].includes(status);
      const score=done && Number.isFinite(Number(s.percentage)) ? `${Number(s.percentage).toFixed(1)}%` : (status || 'Pending');
      const href=done ? `feedback.html?submission_id=${encodeURIComponent(s.submission_id)}` : 'upload-answer.html';
      return `<a href="${href}" class="activity-item submission-table-row" style="text-decoration:none;color:inherit;"><span class="activity-icon"><i class="fa-regular fa-file-lines"></i></span><div class="activity-copy"><strong>${this.escape(s.paper_title||'Answer sheet')}</strong><small>${this.escape(s.subject||'')} · ${this.formatDate(s.evaluated_at||s.submitted_at)}</small></div><span class="activity-score">${this.escape(score)} <i class="fa-solid fa-chevron-right" style="font-size:.65rem;margin-left:.35rem;"></i></span></a>`;
    }).join('');
  },

  renderProgress() {
    const done=this.evaluated().length, pending=this.pending().length, total=done+pending;
    const pct=total ? Math.round(done/total*100) : 0;
    const donut=document.getElementById('progressDonut');
    if(donut) donut.style.background=`conic-gradient(#ff7054 0deg ${pct*3.6}deg,#6c5dbb ${pct*3.6}deg ${(pct*3.6)+Math.max(0,(100-pct)*3.6)}deg,#e8e6eb ${(pct*3.6)+Math.max(0,(100-pct)*3.6)}deg 360deg)`;
    this.text('progressPercent',`${pct}%`); this.text('completedCount',done); this.text('pendingCount',pending);
  },

  renderPapers(list) {
    const el=document.getElementById('availablePapers'); if(!el) return;
    const rows = list || this.papers.slice(0,5);
    if(!rows.length){
      el.innerHTML = this.searchActive
        ? '<div class="list-empty compact"><i class="fa-solid fa-magnifying-glass"></i><span>No papers match your search.</span></div>'
        : '<div class="list-empty compact"><i class="fa-regular fa-folder-open"></i><span>No published papers available.</span></div>';
      return;
    }
    el.innerHTML=rows.map(p=>`<div class="paper-item"><span class="paper-badge"><i class="fa-solid fa-book-open"></i></span><div class="paper-copy"><strong>${this.escape(p.title||'Question paper')}</strong><small>${this.escape(p.subject||'')} · ${p.question_count||0} questions</small></div><a class="paper-action" href="upload-answer.html">Answer</a></div>`).join('');
  },

  applyDashboardFilters() {
    const q=this.searchQuery;
    const matchesSubmission=s=>{
      const status=String(s.status||'').toLowerCase();
      const matchesStatus=this.statusFilter==='all'
        || (this.statusFilter==='success' && ['evaluated','reviewed'].includes(status))
        || (this.statusFilter==='failed' && status==='failed');
      const matchesSearch=!q || [s.paper_title,s.subject,s.status]
        .filter(Boolean)
        .some(v=>String(v).toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    };
    const matchesPaper=p=>!q || [p.title,p.subject,p.topic]
      .filter(Boolean)
      .some(v=>String(v).toLowerCase().includes(q));
    let submissions=this.submissions.filter(matchesSubmission);
    if(!this.searchActive && this.statusFilter==='all') submissions=submissions.slice(0,5);
    let papers=this.papers.filter(matchesPaper);
    if(!this.searchActive) papers=papers.slice(0,5);
    this.renderRecent(submissions);
    this.renderPapers(papers);
  },

  initDashboardFilters() {
    const input=document.getElementById('assignmentSearchInput');
    const select=document.getElementById('studentEvaluationStatusFilter');
    input?.addEventListener('input',e=>{
      this.searchQuery=e.target.value.toLowerCase().trim();
      this.searchActive=!!this.searchQuery;
      this.applyDashboardFilters();
    });
    select?.addEventListener('change',e=>{
      this.statusFilter=e.target.value;
      this.applyDashboardFilters();
    });
  },

  initCalendar() {
    this.calendarDate=new Date();
    const prev=document.getElementById('calendarPrev'), next=document.getElementById('calendarNext');
    prev?.addEventListener('click',()=>{this.calendarDate.setMonth(this.calendarDate.getMonth()-1);this.renderCalendar();});
    next?.addEventListener('click',()=>{this.calendarDate.setMonth(this.calendarDate.getMonth()+1);this.renderCalendar();});
    this.renderCalendar();
  },
  renderCalendar() {
    const box=document.getElementById('miniCalendar'); if(!box) return;
    const d=this.calendarDate, y=d.getFullYear(), m=d.getMonth(), first=new Date(y,m,1), days=new Date(y,m+1,0).getDate(), start=first.getDay();
    this.text('calendarMonth',d.toLocaleString(undefined,{month:'long',year:'numeric'}));
    this.text('calendarDate',new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}));
    const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html='<div class="calendar-week">'+names.map(n=>`<span>${n}</span>`).join('')+'</div><div class="calendar-days">';
    for(let i=0;i<start;i++) html+='<span class="muted"> </span>';
    for(let day=1;day<=days;day++) { const cur=new Date(y,m,day); const today=cur.toDateString()===new Date().toDateString(); html+=`<span data-date="${cur.toISOString().slice(0,10)}" class="${today?'today':''}">${day}</span>`; }
    html+='</div>'; box.innerHTML=html; this.markCalendarDates();
  },
  markCalendarDates() {
    const dates=new Set(this.submissions.map(s=>{const x=s.evaluated_at||s.submitted_at; if(!x)return ''; const d=new Date(x); return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);}));
    document.querySelectorAll('#miniCalendar [data-date]').forEach(el=>{if(dates.has(el.dataset.date)&&!el.classList.contains('today'))el.classList.add('has-evaluation');});
  },
  shortPaper(v){return String(v||'Paper').split(' ').slice(0,2).join(' ');},
  formatDate(v){if(!v)return 'Date unavailable'; const d=new Date(v); return Number.isNaN(d.getTime())?'Date unavailable':d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});},
  text(id,value){const el=document.getElementById(id);if(el)el.textContent=value;},
  escape(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
};
