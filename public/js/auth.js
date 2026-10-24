/* TwinEval AI - behaviour for the authentication pages.
   Depends on js/script.js (TwinEvalApp.apiFetch / session helpers). The session itself is an
   HttpOnly cookie set by the server; nothing secret is stored by these scripts. */
(function () {
  'use strict';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var MIN_PASSWORD = 8;
  var MAX_PASSWORD = 72;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- shared helpers ---------- */
  function setFieldError(input, message) {
    var errorEl = $(input.id + 'Error');
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
    if (errorEl) errorEl.textContent = message || '';
  }

  function showAlert(box, message, kind) {
    if (!box) return;
    var icons = { error: 'fa-circle-exclamation', success: 'fa-circle-check', info: 'fa-circle-info' };
    box.className = 'alert alert-' + (kind || 'error');
    box.textContent = '';
    var icon = document.createElement('i');
    icon.className = 'fa-solid ' + (icons[kind || 'error']);
    icon.setAttribute('aria-hidden', 'true');
    var text = document.createElement('span');
    text.textContent = message;
    box.appendChild(icon);
    box.appendChild(text);
    box.hidden = false;
  }

  function hideAlert(box) { if (box) { box.hidden = true; box.textContent = ''; } }

  function setBusy(button, busy, busyLabel) {
    if (busy) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + busyLabel + '</span>';
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.label) button.innerHTML = button.dataset.label;
    }
  }

  function bindPasswordToggles() {
    document.querySelectorAll('.toggle-pw').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = $(btn.getAttribute('data-for'));
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        btn.querySelector('i').className = 'fa-solid ' + (show ? 'fa-eye-slash' : 'fa-eye');
        input.focus();
      });
    });
  }

  function friendlyError(err) {
    if (err && err.network) return err.message;
    if (err && err.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
    if (err && err.status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
    return (err && err.message) || 'Something went wrong. Please try again.';
  }

  function validateEmailField(input) {
    var value = input.value.trim();
    if (!value) { setFieldError(input, 'Enter your email address.'); return false; }
    if (!EMAIL_RE.test(value)) { setFieldError(input, 'Enter a valid email address, like name@college.edu.'); return false; }
    setFieldError(input, ''); return true;
  }

  function validateNewPassword(input) {
    var value = input.value;
    if (value.length < MIN_PASSWORD) { setFieldError(input, 'Use at least ' + MIN_PASSWORD + ' characters.'); return false; }
    if (value.length > MAX_PASSWORD) { setFieldError(input, 'Use no more than ' + MAX_PASSWORD + ' characters.'); return false; }
    setFieldError(input, ''); return true;
  }

  function validateConfirm(passwordInput, confirmInput) {
    if (confirmInput.value !== passwordInput.value) { setFieldError(confirmInput, 'The passwords do not match.'); return false; }
    setFieldError(confirmInput, ''); return true;
  }

  function focusFirstInvalid(form) {
    var bad = form.querySelector('[aria-invalid="true"]');
    if (bad) bad.focus();
  }

  function swapPanel(hideEl, showEl) {
    hideEl.hidden = true;
    showEl.hidden = false;
    var heading = showEl.querySelector('h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  }

  /* ---------- sign in ---------- */
  function initLogin() {
    var form = $('loginForm');
    var email = $('loginEmail');
    var password = $('loginPassword');
    var remember = $('rememberMe');
    var submit = $('submitLoginBtn');
    var alertBox = $('formAlert');
    var submitting = false;

    // Portal choice: ?role=teacher link, else the last one used on this device.
    var params = new URLSearchParams(window.location.search);
    var preferred = (params.get('role') || '').toLowerCase();
    if (preferred !== 'student' && preferred !== 'teacher') {
      try { preferred = localStorage.getItem('twineval_portal') || 'student'; } catch (_) { preferred = 'student'; }
    }
    var portalInput = document.querySelector('input[name="portal"][value="' + preferred + '"]');
    if (portalInput) portalInput.checked = true;

    var reason = params.get('reason');
    if (reason === 'expired') showAlert(alertBox, 'Your session has ended. Please sign in again.', 'info');
    else if (reason === 'signedout') showAlert(alertBox, 'You have been signed out.', 'success');
    else if (reason === 'reset') showAlert(alertBox, 'Your password was updated. Sign in with your new password.', 'success');
    if (reason) window.history.replaceState(null, '', window.location.pathname);

    email.addEventListener('blur', function () { if (email.value) validateEmailField(email); });
    email.addEventListener('input', function () { if (email.getAttribute('aria-invalid')) validateEmailField(email); });
    password.addEventListener('input', function () { if (password.value) setFieldError(password, ''); });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (submitting) return;
      hideAlert(alertBox);

      var emailOk = validateEmailField(email);
      var passwordOk = true;
      if (!password.value) { setFieldError(password, 'Enter your password.'); passwordOk = false; }
      if (!emailOk || !passwordOk) { focusFirstInvalid(form); return; }

      submitting = true;
      setBusy(submit, true, 'Signing in...');
      try {
        var selected = document.querySelector('input[name="portal"]:checked');
        var chosenPortal = selected ? selected.value : 'student';
        var res = await TwinEvalApp.apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: email.value.trim(), password: password.value, remember: remember.checked })
        });
        var data = res.data;
        var isTeacher = data.role === 'teacher' || data.role === 'admin';
        TwinEvalApp.setUser({
          user_id: data.user_id,
          student_id: data.student_id,
          name: data.name,
          email: data.email,
          role: isTeacher ? 'Teacher' : 'Student',
          avatar_url: data.avatar_url || null
        });
        try { localStorage.setItem('twineval_portal', isTeacher ? 'teacher' : 'student'); } catch (_) {}

        var destination = TwinEvalApp.dashboardFor(data.role);
        if ((isTeacher ? 'teacher' : 'student') !== chosenPortal) {
          showAlert(alertBox, 'This is a ' + (isTeacher ? 'teacher' : 'student') + ' account, so we are opening the ' + (isTeacher ? 'Teacher' : 'Student') + ' portal for you.', 'info');
          setTimeout(function () { window.location.replace(destination); }, 1400);
        } else {
          window.location.replace(destination);
        }
        // Button stays busy while navigating, which also blocks double submits.
      } catch (err) {
        submitting = false;
        setBusy(submit, false);
        showAlert(alertBox, friendlyError(err), 'error');
        if (err && err.status === 401) { password.value = ''; password.focus(); }
        else if (err && err.status === 400) { focusFirstInvalid(form); }
      }
    });
  }

  /* ---------- sign up ---------- */
  function initSignup() {
    var form = $('signupForm');
    var alertBox = $('formAlert');
    var submit = $('submitSignupBtn');
    var studentFields = $('studentFields');
    var rollNumber = $('rollNumber');
    var email = $('signupEmail');
    var name = $('fullName');
    var password = $('signupPassword');
    var confirm = $('confirmPassword');
    var submitting = false;

    function currentRole() { return document.querySelector('input[name="accountRole"]:checked').value; }
    function syncRole() {
      var student = currentRole() === 'student';
      studentFields.hidden = !student;
      rollNumber.required = student;
    }
    document.querySelectorAll('input[name="accountRole"]').forEach(function (r) { r.addEventListener('change', syncRole); });
    syncRole();

    email.addEventListener('blur', function () { if (email.value) validateEmailField(email); });
    password.addEventListener('input', function () { if (password.getAttribute('aria-invalid')) validateNewPassword(password); });
    confirm.addEventListener('input', function () { if (confirm.getAttribute('aria-invalid')) validateConfirm(password, confirm); });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (submitting) return;
      hideAlert(alertBox);
      var isStudent = currentRole() === 'student';

      var ok = true;
      if (!name.value.trim()) { setFieldError(name, 'Enter your full name.'); ok = false; } else setFieldError(name, '');
      ok = validateEmailField(email) && ok;
      if (!$('college').value.trim()) { setFieldError($('college'), 'Enter your college or university.'); ok = false; } else setFieldError($('college'), '');
      if (!$('department').value.trim()) { setFieldError($('department'), 'Enter your department.'); ok = false; } else setFieldError($('department'), '');
      if (isStudent) {
        if (!rollNumber.value.trim()) { setFieldError(rollNumber, 'Enter your roll or register number.'); ok = false; } else setFieldError(rollNumber, '');
      }
      ok = validateNewPassword(password) && ok;
      ok = validateConfirm(password, confirm) && ok;
      if (!ok) { focusFirstInvalid(form); return; }

      var payload = {
        name: name.value.trim(),
        email: email.value.trim(),
        password: password.value,
        college: $('college').value.trim(),
        role: isStudent ? 'student' : 'teacher'
      };
      if (isStudent) {
        payload.department = $('department').value.trim();
        payload.roll_no = rollNumber.value.trim();
        payload.semester = parseInt($('studentSemester').value, 10);
      } else {
        payload.department = $('department').value.trim();
      }

      submitting = true;
      setBusy(submit, true, 'Creating account...');
      try {
        await TwinEvalApp.apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        $('sentTo').textContent = payload.email;
        swapPanel($('signupFormPanel'), $('signupDonePanel'));
      } catch (err) {
        submitting = false;
        setBusy(submit, false);
        showAlert(alertBox, friendlyError(err), 'error');
        alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  /* ---------- forgot password ---------- */
  function initForgot() {
    var form = $('forgotForm');
    var email = $('forgotEmail');
    var submit = $('submitForgotBtn');
    var alertBox = $('formAlert');
    var submitting = false;
    email.addEventListener('blur', function () { if (email.value) validateEmailField(email); });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (submitting) return;
      hideAlert(alertBox);
      if (!validateEmailField(email)) { email.focus(); return; }
      submitting = true;
      setBusy(submit, true, 'Sending...');
      try {
        await TwinEvalApp.apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: email.value.trim() }) });
        $('sentTo').textContent = email.value.trim();
        swapPanel($('forgotFormPanel'), $('forgotDonePanel'));
      } catch (err) {
        submitting = false;
        setBusy(submit, false);
        showAlert(alertBox, friendlyError(err), 'error');
      }
    });
  }

  /* ---------- reset password ---------- */
  function initReset() {
    var form = $('resetForm');
    var password = $('newPassword');
    var confirm = $('confirmNewPassword');
    var submit = $('submitResetBtn');
    var alertBox = $('formAlert');
    var submitting = false;

    // The token travels in the URL fragment, so it is never sent to a server or logged in referrers.
    var match = /(?:^#|&)token=([a-f0-9]{64})(?:&|$)/i.exec(window.location.hash);
    var token = match ? match[1] : null;
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) { swapPanel($('resetFormPanel'), $('resetInvalidPanel')); return; }

    password.addEventListener('input', function () { if (password.getAttribute('aria-invalid')) validateNewPassword(password); });
    confirm.addEventListener('input', function () { if (confirm.getAttribute('aria-invalid')) validateConfirm(password, confirm); });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (submitting) return;
      hideAlert(alertBox);
      var ok = validateNewPassword(password);
      ok = validateConfirm(password, confirm) && ok;
      if (!ok) { focusFirstInvalid(form); return; }
      submitting = true;
      setBusy(submit, true, 'Saving...');
      try {
        await TwinEvalApp.apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: token, password: password.value }) });
        swapPanel($('resetFormPanel'), $('resetDonePanel'));
      } catch (err) {
        submitting = false;
        setBusy(submit, false);
        if (err && err.status === 400 && /link/i.test(err.message || '')) {
          swapPanel($('resetFormPanel'), $('resetInvalidPanel'));
        } else {
          showAlert(alertBox, friendlyError(err), 'error');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindPasswordToggles();
    var page = document.body.getAttribute('data-page');
    if (page === 'login') initLogin();
    else if (page === 'signup') initSignup();
    else if (page === 'forgot') initForgot();
    else if (page === 'reset') initReset();
  });
})();
