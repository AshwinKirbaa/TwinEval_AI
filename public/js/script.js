/**
 * TWINEVAL AI - CORE JAVASCRIPT ENGINE & GLOBAL UTILITIES
 * Series-A SaaS Architecture
 */

/* Pages that do not require a session. Everything else is verified against the server
   (GET /auth/me) before it is shown; the page stays hidden until that check completes. */
const TWINEVAL_PUBLIC_PAGES = ['index.html', 'signup.html', 'verify-email.html', 'forgot-password.html', 'reset-password.html'];
const TWINEVAL_CURRENT_PAGE = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
const TWINEVAL_IS_PUBLIC_PAGE = TWINEVAL_PUBLIC_PAGES.includes(TWINEVAL_CURRENT_PAGE);
if (!TWINEVAL_IS_PUBLIC_PAGE) {
  document.documentElement.classList.add('auth-pending');
  const gateStyle = document.createElement('style');
  gateStyle.textContent = 'html.auth-pending body{visibility:hidden}';
  document.head.appendChild(gateStyle);
}

document.addEventListener('DOMContentLoaded', () => {
  TwinEvalApp.init();
});

const TwinEvalApp = {
  init() {
    this.setToken(null); // drop any legacy token an older version stored in the browser
    this.guardPage();
    this.initTheme();
    this.initSidebar();
    this.initRipples();
    this.initToastSystem();
    this.initParticles();
    this.initActiveLinks();
    this.loadState();
    this.initGlobalEvents();
    this.initDropdowns();
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) this.guardPage(); // page restored from back/forward cache: re-verify
    });
  },

  /* ==========================================
     0. SESSION GUARD
     The browser never holds the credential (it lives in an HttpOnly
     cookie), so "signed in" is always decided by the server:
       - protected pages: ask /auth/me; redirect to sign-in if rejected,
         or to the user's own dashboard if the role does not fit the page
       - sign-in page: if a valid session exists, go straight to the dashboard
     The role used here comes from the server response, never from storage.
     ========================================== */
  STUDENT_ONLY_PAGES: ['student-dashboard.html', 'upload-answer.html', 'results.html', 'feedback.html', 'analytics.html', 'processing.html'],

  dashboardFor(role) {
    return (role === 'teacher' || role === 'admin') ? 'teacher-dashboard.html' : 'student-dashboard.html';
  },

  allowedOnCurrentPage(role) {
    const page = TWINEVAL_CURRENT_PAGE;
    const isTeacherRole = role === 'teacher' || role === 'admin';
    if (page.startsWith('teacher-')) return isTeacherRole;
    if (this.STUDENT_ONLY_PAGES.includes(page)) return role === 'student';
    return true; // shared pages (profile, settings)
  },

  isSignedIn() {
    const user = this.getUser();
    return Boolean(user && user.user_id);
  },

  clearSession() {
    this.setToken(null);
    localStorage.removeItem('twineval_user');
  },

  redirectToSignIn(reason) {
    this.clearSession();
    window.location.replace('index.html' + (reason ? `?reason=${reason}` : ''));
  },

  async fetchSession() {
    const response = await fetch(`${this.API_BASE}/auth/me`, {
      cache: 'no-store',
      credentials: this.API_BASE ? 'include' : 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (response.status === 401 || response.status === 403) return { authenticated: false };
    if (!response.ok) throw new Error(`Session check failed (${response.status})`);
    const body = await response.json();
    return { authenticated: true, user: body.data };
  },

  async guardPage() {
    const onSignIn = TWINEVAL_CURRENT_PAGE === 'index.html';
    if (TWINEVAL_IS_PUBLIC_PAGE && !onSignIn) return;
    const reveal = () => document.documentElement.classList.remove('auth-pending');
    try {
      const session = await this.fetchSession();
      if (onSignIn) {
        if (session.authenticated) window.location.replace(this.dashboardFor(session.user.role));
        return;
      }
      if (!session.authenticated) return this.redirectToSignIn('expired');
      const role = session.user.role;
      if (!this.allowedOnCurrentPage(role)) {
        return window.location.replace(this.dashboardFor(role));
      }
      this.applyServerUser(session.user);
      reveal();
      document.dispatchEvent(new CustomEvent('twineval:auth-ready', { detail: session.user }));
    } catch (err) {
      // Server unreachable. Show the page only if this browser has a known user; every API call
      // is still authenticated server-side, so nothing protected can load.
      if (onSignIn) return;
      if (this.isSignedIn()) {
        reveal();
        this.showToast('You appear to be offline', 'We could not reach the server. Some data may not load.', 'warning');
      } else {
        this.redirectToSignIn();
      }
    }
  },

  /** Merge the authoritative server record into the locally cached (non-secret) profile. */
  applyServerUser(fresh) {
    const current = this.getUser() || {};
    this.setUser({
      ...current,
      user_id: fresh.user_id,
      student_id: fresh.student_id ?? current.student_id ?? null,
      name: fresh.name || current.name,
      email: fresh.email || current.email,
      college: fresh.college ?? current.college ?? '',
      department: fresh.department ?? current.department ?? '',
      year: fresh.year ?? current.year ?? '',
      role: fresh.role === 'student' ? 'Student' : 'Teacher',
      avatar_url: fresh.avatar_url || null,
    });
  },

  /* ==========================================
     1. THEME ENGINE (LIGHT MODE ONLY)
     Dark mode has been removed -- the app is light-mode only. This
     just clears out any stale 'dark' preference a returning visitor's
     browser might still have saved from before, so it can't cause a
     flash of dark styling on load.
     ========================================== */
  initTheme() {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.removeItem('twineval_theme');
  },

  /* ==========================================
     2. SIDEBAR NAV & MOBILE COLLAPSE
     ========================================== */
  initSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const mobileToggle = document.querySelector('.mobile-nav-toggle');

    if (mobileToggle && sidebar) {
      mobileToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('open');
      });

      document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !mobileToggle.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      });
    }
  },

  initActiveLinks() {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPath) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  },

  /* ==========================================
     3. BUTTON RIPPLE EFFECT
     ========================================== */
  initRipples() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('.btn, .glass-card-interactive, .nav-link');
      if (!target) return;

      const ripple = document.createElement('span');
      ripple.classList.add('ripple');
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

      target.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  },

  /* ==========================================
     4. TOAST NOTIFICATION ENGINE
     ========================================== */
  initToastSystem() {
    if (!document.querySelector('.toast-container')) {
      const container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
  },

  showToast(title, message, type = 'primary') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    
    const iconMap = {
      primary: 'fa-solid fa-circle-info',
      success: 'fa-solid fa-circle-check',
      danger: 'fa-solid fa-circle-xmark',
      warning: 'fa-solid fa-triangle-exclamation',
      info: 'fa-solid fa-bolt'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="${iconMap[type] || iconMap.primary} toast-icon"></i>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  /* ==========================================
     5. PARTICLE & AI BACKGROUND ENGINE
     ========================================== */
  initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.width = canvas.parentElement.clientWidth;
    let height = canvas.height = canvas.parentElement.clientHeight;

    window.addEventListener('resize', () => {
      if (canvas.parentElement) {
        width = canvas.width = canvas.parentElement.clientWidth;
        height = canvas.height = canvas.parentElement.clientHeight;
      }
    });

    const particles = Array.from({ length: 40 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.7,
      vy: (Math.random() - 0.5) * 0.7,
      radius: Math.random() * 2.5 + 1
    }));

    function render() {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(37, 99, 235, ${0.22 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#06b6d4';
        ctx.fill();
      });

      requestAnimationFrame(render);
    }

    render();
  },

  /* ==========================================
     6. STATE MANAGEMENT ENGINE
     ========================================== */
  loadState() {
    if (!localStorage.getItem('twineval_user')) {
      const defaultUser = {
        name: '{{student_name}}',
        email: '',
        role: 'Student',
        college: '',
        department: '',
        year: ''
      };
      localStorage.setItem('twineval_user', JSON.stringify(defaultUser));
    }

    if (!localStorage.getItem('twineval_submissions')) {
      localStorage.setItem('twineval_submissions', JSON.stringify([]));
    }
  },

  getUser() {
    return JSON.parse(localStorage.getItem('twineval_user'));
  },

  setUser(userData) {
    localStorage.setItem('twineval_user', JSON.stringify(userData));
    this.updateUserUI();
  },

  /* ==========================================
     6b. REAL BACKEND API CLIENT
     Same-origin by default (this frontend is served by the same
     Express app as the API). Set window.TWINEVAL_API_BASE before
     script.js loads if the frontend is ever hosted separately.
     ========================================== */
  API_BASE: (typeof window !== 'undefined' && window.TWINEVAL_API_BASE) || '',

  /**
   * Uploaded file URLs (e.g. avatar_url) come back from the API as a
   * path relative to the API's own origin (e.g. "/uploads/x.png"). When
   * the frontend and API are served from the same origin (the default
   * setup -- API_BASE is '') this is already correct as-is. If
   * API_BASE points elsewhere, the path needs that origin prefixed so
   * the browser doesn't resolve it against the wrong (frontend) origin.
   */
  resolveUploadUrl(path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path; // already absolute
    return `${this.API_BASE}${path}`;
  },

  /* The session credential is an HttpOnly cookie that scripts cannot read, so there is
     no token to store. setToken(null) only removes a token an older version left behind. */
  setToken() {
    localStorage.removeItem('twineval_token');
  },

  /**
   * Thin fetch wrapper: attaches the JWT automatically, sets
   * Content-Type for JSON bodies (skipped for FormData so the browser
   * can set its own multipart boundary), and throws a normal Error
   * with the backend's message on non-2xx responses so callers can
   * just try/catch instead of checking res.ok everywhere.
   */
  async apiFetch(path, options = {}) {
    const headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, options.headers || {});
    if (!(options.body instanceof FormData) && options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const requestOptions = Object.assign({ credentials: this.API_BASE ? 'include' : 'same-origin' }, options, { headers });
    // API JSON requests should always receive a body. Browser/server
    // revalidation can otherwise surface a raw 304 response here, which
    // has no JSON payload and makes dashboard Promise.all calls fail.
    if (!requestOptions.method || requestOptions.method.toUpperCase() === 'GET') {
      requestOptions.cache = 'no-store';
    }
    let response;
    try {
      response = await fetch(`${this.API_BASE}${path}`, requestOptions);
    } catch (networkError) {
      const err = new Error('We could not reach the server. Check your connection and try again.');
      err.network = true;
      throw err;
    }

    // An expired/invalid session on a protected page sends the user back to sign in.
    if (response.status === 401 && !TWINEVAL_IS_PUBLIC_PAGE) {
      this.redirectToSignIn('expired');
    }

    // Some endpoints (PDF download) return a raw file, not JSON --
    // let the caller handle `response` directly for those.
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!response.ok) {
        const err = new Error(`Request failed (${response.status})`);
        err.status = response.status;
        throw err;
      }
      return response;
    }

    const data = await response.json();
    if (!response.ok) {
      const err = new Error((data && data.message) || `Request failed (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  updateUserUI() {
    const user = this.getUser();
    if (!user) return;
    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = user.name);
    document.querySelectorAll('.user-role-display').forEach(el => el.textContent = user.role);
    document.querySelectorAll('.user-role').forEach(el => el.textContent = user.role === 'Teacher' ? 'Educator' : 'Student');
    document.querySelectorAll('.profile-role-display').forEach(el => el.textContent = user.role === 'Teacher' ? 'Educator' : 'Student');
    document.querySelectorAll('.user-email-display').forEach(el => el.textContent = user.email);
    document.querySelectorAll('.user-dept-display').forEach(el => el.textContent = user.department);
    document.querySelectorAll('.user-avatar').forEach(el => {
      el.innerHTML = user.avatar_url
        ? `<img src="${this.resolveUploadUrl(user.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
        : '<i class="fa-solid fa-user"></i>';
    });
  },

  initGlobalEvents() {
    this.updateUserUI();

    // Quick logout handler
    document.querySelectorAll('.logout-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    });
  },

  async logout() {
    try {
      await fetch(`${this.API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: this.API_BASE ? 'include' : 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
    } catch (_) { /* cookie is cleared locally by the redirect below even if offline */ }
    this.clearSession();
    window.location.replace('index.html?reason=signedout');
  },

  /* ==========================================
     6c. ACCOUNT / NOTIFICATIONS DROPDOWNS
     The top-right account pill was a plain, non-interactive <div> on
     every page (and the notifications bell next to it had the same
     gap -- markup existed but nothing wired it up). This progressively
     enhances any .user-profile-pill into a real dropdown trigger with
     Profile Settings / System Settings / Toggle Theme / Sign Out,
     and wires up ANY .dropdown-wrapper (including the pre-existing
     notifications one) with one shared, consistent toggle behavior --
     without needing to hand-edit every page's HTML.
     ========================================== */
  normalizeAccountPills() {
    // Legacy teacher pages render the account pill directly inside
    // `.header-actions`, unlike student pages which already provide an
    // `.account-wrap` and menu. Normalize the legacy markup so every role
    // gets the same accessible account dropdown behavior.
    document.querySelectorAll('.user-profile-pill').forEach(pill => {
      if (pill.closest('.dropdown-wrapper')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'dropdown-wrapper account-wrap';
      pill.parentNode.insertBefore(wrapper, pill);
      wrapper.appendChild(pill);
      pill.setAttribute('role', 'button');
      pill.setAttribute('tabindex', '0');
      pill.setAttribute('aria-label', 'Open account menu');

      const menu = document.createElement('div');
      menu.className = 'dropdown-menu account-dropdown-menu';
      menu.hidden = true;
      wrapper.appendChild(menu);
    });
  },

  observeDynamicDropdowns() {
    if (this._dropdownObserver || !document.body) return;
    this._dropdownObserver = new MutationObserver(mutations => {
      const changed = mutations.some(mutation => [...mutation.addedNodes].some(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        return node.matches('.dropdown-wrapper, .user-profile-pill') ||
          node.querySelector?.('.dropdown-wrapper, .user-profile-pill');
      }));
      if (changed) this.initDropdowns();
    });
    this._dropdownObserver.observe(document.body, { childList: true, subtree: true });
  },

  initDropdowns() {
    this.normalizeAccountPills();
    const wrappers = document.querySelectorAll('.dropdown-wrapper');

    wrappers.forEach(wrapper => {
      // `querySelector` does not accept a bare child combinator in a selector
      // list (`..., > button`), which used to throw a SyntaxError and abort
      // every dropdown binding on dashboard pages. A wrapper only has one
      // trigger, so selecting any button inside it is both valid and precise.
      const trigger = wrapper.querySelector('.user-profile-pill, .header-icon-btn, button');
      const menu = wrapper.querySelector('.dropdown-menu');
      if (!trigger || !menu) return;

      trigger.setAttribute('aria-haspopup', 'true');
      if (!trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;

      if (!menu.querySelector('.js-dropdown-logout') && wrapper.classList.contains('account-wrap')) {
        menu.innerHTML = `
          <div class="account-menu-head">
            <span class="user-avatar large"><i class="fa-solid fa-user"></i></span>
            <div><strong class="user-name-display">Account</strong><small>Student account</small></div>
          </div>
          <a class="dropdown-item" href="profile.html"><i class="fa-solid fa-user"></i><span>Profile</span></a>
          <a class="dropdown-item" href="settings.html"><i class="fa-solid fa-sliders"></i><span>Settings</span></a>
          <div class="dropdown-divider"></div>
          <button type="button" class="dropdown-item dropdown-item-btn js-dropdown-logout"><i class="fa-solid fa-right-from-bracket"></i><span>Sign out</span></button>`;
      }

      const logoutBtn = menu.querySelector('.js-dropdown-logout');
      if (logoutBtn && logoutBtn.dataset.bound !== '1') {
        logoutBtn.dataset.bound = '1';
        logoutBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this.logout(); });
      }

      if (trigger.dataset.dropdownBound === '1') return;
      trigger.dataset.dropdownBound = '1';
      trigger.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const opening = menu.hidden;
        this.closeAllDropdowns(wrapper);
        menu.hidden = !opening;
        trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
        wrapper.classList.toggle('is-open', opening);
      });

      trigger.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
        if (e.key === 'Escape') { this.closeAllDropdowns(); trigger.focus(); }
      });
      menu.addEventListener('click', e => e.stopPropagation());
    });

    if (!this._dropdownDocumentBound) {
      this._dropdownDocumentBound = true;
      document.addEventListener('click', () => this.closeAllDropdowns());
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeAllDropdowns(); });
    }

    this.updateUserUI();
    this.observeDynamicDropdowns();
  },

  closeAllDropdowns(exceptWrapper = null) {
    document.querySelectorAll('.dropdown-wrapper').forEach(wrapper => {
      if (exceptWrapper && wrapper === exceptWrapper) return;
      const menu = wrapper.querySelector('.dropdown-menu');
      const trigger = wrapper.querySelector('.user-profile-pill, .header-icon-btn, button');
      if (menu) menu.hidden = true;
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      wrapper.classList.remove('is-open');
    });
  },

  /* ==========================================
     7. PURE VANILLA SVG CHART GENERATOR ENGINE
     ========================================== */
  Charts: {
    createBarChart(containerId, labels, values, color = '#2563eb') {
      const container = document.getElementById(containerId);
      if (!container) return;

      const maxVal = Math.max(...values, 100);
      const svgHeight = 220;
      const containerWidth = container.clientWidth || 400;
      const barWidth = Math.min(42, Math.floor((containerWidth - 60) / labels.length - 16));
      const spacing = (containerWidth - 40) / labels.length;

      let barsHtml = labels.map((label, idx) => {
        const val = values[idx];
        const barHeight = Math.max(10, (val / maxVal) * (svgHeight - 60));
        const x = 25 + idx * spacing + (spacing - barWidth) / 2;
        const y = svgHeight - 35 - barHeight;

        return `
          <g class="bar-group">
            <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${color}" opacity="0.85">
              <animate attributeName="height" from="0" to="${barHeight}" dur="0.8s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
              <animate attributeName="y" from="${svgHeight - 35}" to="${y}" dur="0.8s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
            </rect>
            <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-main)">${val}%</text>
            <text x="${x + barWidth / 2}" y="${svgHeight - 12}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${label}</text>
          </g>
        `;
      }).join('');

      container.innerHTML = `
        <svg width="100%" height="${svgHeight}" style="overflow: visible;">
          <line x1="15" y1="${svgHeight - 35}" x2="100%" y2="${svgHeight - 35}" stroke="var(--border-subtle)" stroke-width="1.5"/>
          ${barsHtml}
        </svg>
      `;
    },

    createDonutChart(containerId, label, percentage, color = '#06b6d4') {
      const container = document.getElementById(containerId);
      if (!container) return;

      const radius = 60;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - (percentage / 100) * circumference;

      container.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 160px; height: 160px; margin: 0 auto;">
          <svg width="160" height="160" style="transform: rotate(-90deg);">
            <circle cx="80" cy="80" r="${radius}" stroke="var(--border-subtle)" stroke-width="12" fill="transparent"/>
            <circle cx="80" cy="80" r="${radius}" stroke="${color}" stroke-width="12" fill="transparent"
                    stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                    stroke-linecap="round" style="transition: stroke-dashoffset 1s ease-out;"/>
          </svg>
          <div style="position: absolute; text-align: center;">
            <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-main); line-height: 1;">${percentage}%</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500; margin-top: 2px;">${label}</div>
          </div>
        </div>
      `;
    },

    createLineChart(containerId, labels, values, color = '#2563eb') {
      const container = document.getElementById(containerId);
      if (!container) return;

      const height = 220;
      const width = container.clientWidth || 400;
      const padding = 35;
      const maxVal = Math.max(...values, 100);
      const minVal = 50;

      const points = values.map((val, idx) => {
        const x = padding + (idx * (width - 2 * padding)) / (labels.length - 1);
        const y = height - padding - ((val - minVal) / (maxVal - minVal)) * (height - 2 * padding);
        return { x, y, val, label: labels[idx] };
      });

      const pathD = points.reduce((acc, p, idx) => {
        return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
      }, '');

      const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

      let dotsHtml = points.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="5" fill="${color}" stroke="var(--bg-card)" stroke-width="2"/>
        <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-main)">${p.val}%</text>
        <text x="${p.x}" y="${height - 12}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${p.label}</text>
      `).join('');

      container.innerHTML = `
        <svg width="100%" height="${height}" style="overflow: visible;">
          <defs>
            <linearGradient id="lineGrad-${containerId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="var(--border-subtle)" stroke-width="1.5"/>
          <path d="${areaD}" fill="url(#lineGrad-${containerId})"/>
          <path d="${pathD}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
          ${dotsHtml}
        </svg>
      `;
    },

    createRadarChart(containerId, labels, values) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const size = 260;
      const center = size / 2;
      const radius = 85;
      const total = labels.length;

      let gridHtml = '';
      for (let r = 0.25; r <= 1; r += 0.25) {
        const points = [];
        for (let i = 0; i < total; i++) {
          const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
          const x = center + radius * r * Math.cos(angle);
          const y = center + radius * r * Math.sin(angle);
          points.push(`${x},${y}`);
        }
        gridHtml += `<polygon points="${points.join(' ')}" fill="none" stroke="var(--border-subtle)" stroke-width="1"/>`;
      }

      const dataPoints = values.map((val, i) => {
        const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
        const x = center + (radius * (val / 100)) * Math.cos(angle);
        const y = center + (radius * (val / 100)) * Math.sin(angle);
        return `${x},${y}`;
      }).join(' ');

      const labelsHtml = labels.map((lbl, i) => {
        const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
        const lx = center + (radius + 22) * Math.cos(angle);
        const ly = center + (radius + 14) * Math.sin(angle);
        return `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-main)">${lbl}</text>`;
      }).join('');

      container.innerHTML = `
        <svg width="${size}" height="${size}" style="margin: 0 auto; display: block;">
          ${gridHtml}
          <polygon points="${dataPoints}" fill="rgba(37, 99, 235, 0.25)" stroke="#2563eb" stroke-width="2.5"/>
          ${labelsHtml}
        </svg>
      `;
    }
  }
};
