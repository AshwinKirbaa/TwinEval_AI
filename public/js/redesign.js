/* TwinEval AI — Eduka reference UI behaviour */
(function () {
  // The previous build could leave the whole application in its dark theme.
  // Reset that old preference once for the Eduka redesign, then normal theme
  // toggling continues to work through the existing application code.
  if (!localStorage.getItem('twineval_eduka_v2_seen')) {
    localStorage.setItem('twineval_theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('twineval_eduka_v2_seen', '1');
  }

  function getRole() {
    try {
      const user = JSON.parse(localStorage.getItem('twineval_user') || '{}');
      return String(user.role || '').toLowerCase();
    } catch (_) { return ''; }
  }

  function setNames() {
    let user = {};
    try { user = JSON.parse(localStorage.getItem('twineval_user') || '{}'); } catch (_) {}
    const name = user.name || (getRole() === 'teacher' ? 'Teacher' : 'Student');
    document.querySelectorAll('.user-name-display').forEach(el => { el.textContent = name; });
  }

  function setupNavigation() {
    const path = location.pathname.toLowerCase();
    const teacherPage = path.includes('teacher-');
    const role = getRole() || (teacherPage ? 'teacher' : 'student');
    const isTeacher = role === 'teacher' || role === 'admin';
    const nav = document.querySelector('.sidebar-nav');

    // profile.html and settings.html are SHARED between both roles, but
    // ship with a hardcoded STUDENT sidebar in their raw HTML (student
    // hrefs like "student-dashboard.html", "upload-answer.html", etc).
    // A teacher (or admin) viewing either page must have those links
    // rewritten to the teacher-equivalent destinations -- relabeling
    // the visible text alone (the old behavior here) left the
    // underlying href untouched, so a teacher clicking "Dashboard" from
    // their own profile page would silently land on the STUDENT
    // dashboard and end up navigating the app as if they were a
    // student. That identity/navigation mismatch is fixed here by
    // rewriting both the href and the label together.
    const STUDENT_TO_TEACHER_LINK = {
      'student-dashboard.html': { href: 'teacher-dashboard.html', label: 'Dashboard' },
      'upload-answer.html': { href: 'teacher-upload.html', label: 'Question Papers' },
      'results.html': { href: 'teacher-review.html', label: 'Evaluations' },
      'analytics.html': { href: 'teacher-analytics.html', label: 'Analytics' },
      'feedback.html': null, // no teacher equivalent -- remove this link entirely
    };
    const SHARED_PAGE_LABELS = {
      'profile.html': { student: 'Profile Settings', teacher: 'Profile' },
      'settings.html': { student: 'System Settings', teacher: 'Settings' },
    };

    if (nav) {
      nav.querySelectorAll('a.nav-link').forEach(a => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        const span = a.querySelector('span');

        if (isTeacher && Object.prototype.hasOwnProperty.call(STUDENT_TO_TEACHER_LINK, href)) {
          const mapping = STUDENT_TO_TEACHER_LINK[href];
          if (!mapping) { a.remove(); return; }
          a.setAttribute('href', mapping.href);
          if (span) span.textContent = mapping.label;
          return;
        }

        // Results are intentionally opened from evaluation cards/alerts, not
        // kept as a separate student sidebar destination.
        if (!isTeacher && href === 'results.html') {
          a.remove();
          return;
        }

        if (SHARED_PAGE_LABELS[href] && span) {
          span.textContent = isTeacher ? SHARED_PAGE_LABELS[href].teacher : SHARED_PAGE_LABELS[href].student;
        } else if (isTeacher) {
          const labels = {'teacher-dashboard.html':'Dashboard','teacher-upload.html':'Question Papers','teacher-review.html':'Evaluations','teacher-analytics.html':'Analytics'};
          if (labels[href] && span) span.textContent = labels[href];
        } else {
          const labels = {'student-dashboard.html':'Dashboard','upload-answer.html':'Upload Answer','results.html':'Results','analytics.html':'Analytics'};
          if (labels[href] && span) span.textContent = labels[href];
        }
      });

      nav.querySelectorAll('.nav-section-title').forEach(s => {
        if (/main menu|teacher portal/i.test(s.textContent)) s.textContent = 'WORKSPACE';
        if (/system/i.test(s.textContent)) s.textContent = 'ACCOUNT';
      });
    }

    // The role badge next to the account name/avatar (".user-role") was
    // static HTML on every page -- hardcoded "Student" even on the
    // teacher-only pages that happened to say "Educator" by luck of
    // what was typed into that page's HTML. Set it dynamically instead
    // so it always reflects who's actually logged in.
    document.querySelectorAll('.user-role').forEach(el => {
      el.textContent = isTeacher ? 'Educator' : 'Student';
    });

    const brand = document.querySelector('.sidebar-header .brand-name');
    if (brand) brand.innerHTML = isTeacher ? 'TwinEval <span>Educator</span>' : 'TwinEval <span>AI</span>';
  }

  async function ensureNotification() {
    const header = document.querySelector('.top-header .header-actions');
    if (!header) return;
    let wrap = header.querySelector('.notification-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'dropdown-wrapper notification-wrap';
      wrap.innerHTML = `
        <button type="button" class="header-icon-btn" id="notificationBtn" aria-label="Notifications" aria-expanded="false" aria-haspopup="true">
          <i class="fa-regular fa-bell"></i><span class="notification-dot" hidden></span>
        </button>
        <div class="dropdown-menu notification-menu" id="notificationDropdownMenu" hidden></div>`;
      const profile = header.querySelector('.account-wrap');
      header.insertBefore(wrap, profile || null);
    }

    const menu = wrap.querySelector('.notification-menu');
    if (!menu) return;
    menu.innerHTML = '<div class="dropdown-heading">Notifications</div><div class="notification-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking updates...</div>';

    try {
      if (!window.TwinEvalApp || !TwinEvalApp.getToken()) throw new Error('not authenticated');
      const [submissionResponse, paperResponse] = await Promise.all([
        TwinEvalApp.apiFetch('/submissions'),
        TwinEvalApp.apiFetch('/papers')
      ]);
      const submissions = Array.isArray(submissionResponse.data) ? submissionResponse.data : [];
      const papers = Array.isArray(paperResponse.data) ? paperResponse.data : [];
      const notices = [];
      const icon = {processing:'fa-solid fa-spinner', evaluated:'fa-solid fa-circle-check', reviewed:'fa-solid fa-user-check', failed:'fa-solid fa-circle-exclamation', reminder:'fa-solid fa-calendar-check', missed:'fa-solid fa-clock'};
      const statusTitle = {processing:'Evaluation in progress', evaluated:'Evaluation completed', reviewed:'Teacher review completed', failed:'Evaluation needs attention'};

      submissions.slice(0, 6).forEach(s => {
        const status = String(s.status || '').toLowerCase();
        if (!['processing', 'evaluated', 'reviewed', 'failed'].includes(status)) return;
        const detail = status === 'evaluated' || status === 'reviewed'
          ? `${Number(s.percentage || 0).toFixed(1)}% · ${String(s.grade || 'Pending grade')}`
          : status === 'failed' ? (s.error_message || 'Please upload the answer sheet again.') : 'TwinEval is processing your submission.';
        notices.push({ status, title: statusTitle[status], paper: String(s.paper_title || 'Answer sheet'), detail, href: status === 'evaluated' || status === 'reviewed' ? `results.html?submission_id=${encodeURIComponent(s.submission_id)}` : 'upload-answer.html', time: s.evaluated_at || s.submitted_at || '' });
      });

      // A published paper with no matching submission is actionable. Older
      // papers become "missed" reminders; newer ones are upcoming reminders.
      const submittedPaperIds = new Set(submissions.map(s => String(s.paper_id)));
      papers.filter(p => getRole() !== 'teacher' && getRole() !== 'admin' && String(p.status || '').toLowerCase() === 'published' && !submittedPaperIds.has(String(p.paper_id))).slice(0, 4).forEach(p => {
        const ageDays = p.created_at ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000) : 0;
        const missed = ageDays >= 7;
        notices.push({ status: missed ? 'missed' : 'reminder', title: missed ? 'Missed evaluation reminder' : 'Upcoming evaluation', paper: String(p.title || p.subject || 'Question paper'), detail: missed ? 'This published paper is still waiting for your answer sheet.' : 'A new paper is available to evaluate.', href: 'upload-answer.html', time: p.created_at || '' });
      });

      notices.sort((a, b) => String(b.time).localeCompare(String(a.time)));
      const recent = notices.slice(0, 8);
      const dot = wrap.querySelector('.notification-dot');
      if (dot) dot.hidden = recent.length === 0;

      if (!recent.length) {
        menu.innerHTML = `<div class="dropdown-heading">Notifications</div>
          <div class="notification-empty"><span><i class="fa-regular fa-bell-slash"></i></span><strong>You're all caught up</strong><small>No pending evaluations or new results.</small></div>`;
        return;
      }

      const items = recent.map(n => `<a class="notification-item" href="${n.href}">
        <span class="notification-icon ${n.status}"><i class="${icon[n.status] || 'fa-regular fa-bell'}"></i></span>
        <span class="notification-copy"><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(n.paper)}</small><em>${escapeHtml(n.detail)}</em></span>
      </a>`).join('');
      menu.innerHTML = `<div class="dropdown-heading">Notifications <span>${recent.length}</span></div>${items}`;
    } catch (_) {
      menu.innerHTML = `<div class="dropdown-heading">Notifications</div>
        <div class="notification-empty"><span><i class="fa-solid fa-bell"></i></span><strong>Notifications unavailable</strong><small>Sign in to see evaluation updates.</small></div>`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function polishAccountPills() {
    document.querySelectorAll('.user-profile-pill').forEach(pill => {
      if (!pill.querySelector('.account-chevron')) {
        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-down account-chevron';
        pill.appendChild(chevron);
      }
    });
  }

  function setupMobileOverlay() {
    const sidebar = document.querySelector('.sidebar');
    const toggle = document.querySelector('.mobile-nav-toggle');
    if (!sidebar || !toggle) return;
    let overlay = document.querySelector('.nav-overlay');
    if (!overlay) {
      overlay = document.createElement('div'); overlay.className = 'nav-overlay'; document.body.appendChild(overlay);
      overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); });
    }
    toggle.addEventListener('click', () => setTimeout(() => overlay.classList.toggle('show', sidebar.classList.contains('open')), 0));
    sidebar.addEventListener('click', e => { if (e.target.closest('a')) { sidebar.classList.remove('open'); overlay.classList.remove('show'); } });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('eduka-page');
    setupNavigation();
    setNames();
    polishAccountPills();
    setupMobileOverlay();
    // Notification markup may be created asynchronously on legacy pages.
    // Bind the dropdown only after that markup exists.
    ensureNotification().finally(() => {
      if (window.TwinEvalApp && typeof TwinEvalApp.initDropdowns === 'function') TwinEvalApp.initDropdowns();
    });
  });
})();
