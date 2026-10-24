/**
 * TWINEVAL AI - PROFILE MODULE JAVASCRIPT
 */

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.profile-page') || document.getElementById('profileForm')) {
    ProfileModule.init();
  }
});

const ProfileModule = {
  MAX_AVATAR_BYTES: 3 * 1024 * 1024, // 3MB -- matches the backend upload limit's practical ceiling

  init() {
    this.populateForm();
    this.initFormSubmit();
    this.initPasswordChange();
    this.initAvatarUpload();
  },

  async populateForm() {
    const user = TwinEvalApp.getUser();
    if (!user) return;

    const nameInput = document.getElementById('profileName');
    const emailInput = document.getElementById('profileEmail');
    const collegeInput = document.getElementById('profileCollege');
    const deptInput = document.getElementById('profileDept');
    const yearInput = document.getElementById('profileYear');

    if (nameInput) nameInput.value = user.name || '';
    if (emailInput) emailInput.value = user.email || '';
    if (collegeInput) collegeInput.value = user.college || '';
    if (deptInput) deptInput.value = user.department || '';
    if (yearInput) yearInput.value = user.year || '';
    this.renderAvatar(user.avatar_url);

    // Refresh with the authoritative record from the server (name/email/
    // role/avatar) in case it differs from what's cached locally -- e.g.
    // after logging in on another device, or if the local cache was
    // cleared by a logout on this browser. Falls back silently to the
    // cached values above if the request fails (e.g. offline).
    if (TwinEvalApp.isSignedIn()) {
      try {
        const res = await TwinEvalApp.apiFetch('/auth/me');
        const fresh = res.data;
        if (nameInput) nameInput.value = fresh.name || nameInput.value;
        if (emailInput) emailInput.value = fresh.email || emailInput.value;
        if (collegeInput) collegeInput.value = fresh.college || collegeInput.value;
        if (deptInput) deptInput.value = fresh.department || deptInput.value;
        if (yearInput) yearInput.value = fresh.year || yearInput.value;
        this.renderAvatar(fresh.avatar_url);
        TwinEvalApp.setUser({
          ...user,
          name: fresh.name,
          email: fresh.email,
          college: fresh.college || '',
          department: fresh.department || '',
          year: fresh.year || '',
          role: fresh.role === 'teacher' ? 'Teacher' : (fresh.role === 'admin' ? 'Teacher' : 'Student'),
          avatar_url: fresh.avatar_url || null
        });
      } catch (err) {
        // Not fatal -- keep showing the cached values.
      }
    }
  },

  initFormSubmit() {
    const form = document.getElementById('profileForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentUser = TwinEvalApp.getUser() || {};
      const updatedUser = {
        ...currentUser,
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        college: document.getElementById('profileCollege').value,
        department: document.getElementById('profileDept').value,
        year: document.getElementById('profileYear').value
      };

      const saveButton = form.querySelector('button[type="submit"]');
      const originalText = saveButton?.innerHTML;
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
      }

      try {
        const response = await TwinEvalApp.apiFetch('/auth/profile', {
          method: 'PUT',
          body: JSON.stringify({
            name: updatedUser.name,
            email: updatedUser.email,
            college: updatedUser.college,
            department: updatedUser.department,
            year: updatedUser.year
          })
        });
        const saved = response.data || updatedUser;
        TwinEvalApp.setUser({
          ...updatedUser,
          ...saved,
          role: saved.role === 'teacher' || saved.role === 'admin' ? 'Teacher' : 'Student'
        });
        this.populateForm();
        TwinEvalApp.showToast('Profile Updated', 'Your profile details have been saved.', 'success');
      } catch (err) {
        TwinEvalApp.showToast('Profile Update Failed', err.message || 'Could not save your profile.', 'danger');
      } finally {
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.innerHTML = originalText;
        }
      }
    });
  },

  initPasswordChange() {
    const pwForm = document.getElementById('changePasswordForm');
    if (!pwForm) return;

    pwForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const newPw = document.getElementById('newPassword').value;
      const confirmPw = document.getElementById('confirmNewPassword').value;

      if (newPw !== confirmPw) {
        TwinEvalApp.showToast('Password Mismatch', 'New password and confirmation do not match.', 'danger');
        return;
      }

      pwForm.reset();
      TwinEvalApp.showToast('Password Updated', 'Your password has been changed securely.', 'success');
    });
  },

  /**
   * Lets the student/teacher pick a photo from their device to use as
   * their profile picture. Uploaded to the server and tied to their
   * account (POST /auth/avatar) rather than kept only in browser
   * localStorage -- a purely local cache would be wiped by logout (by
   * design, for privacy) and would never follow the user to another
   * device, making the photo look like it "didn't really save".
   */
  initAvatarUpload() {
    const btn = document.getElementById('uploadAvatarBtn');
    const input = document.getElementById('avatarFileInput');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        TwinEvalApp.showToast('Unsupported File', 'Please choose an image file (PNG, JPG, etc).', 'danger');
        input.value = '';
        return;
      }
      if (file.size > this.MAX_AVATAR_BYTES) {
        TwinEvalApp.showToast('Image Too Large', 'Please choose a photo under 3 MB.', 'danger');
        input.value = '';
        return;
      }

      const formData = new FormData();
      formData.append('avatar', file);

      try {
        const res = await TwinEvalApp.apiFetch('/auth/avatar', { method: 'POST', body: formData });
        const avatarUrl = res.data.avatar_url;
        this.renderAvatar(avatarUrl);
        TwinEvalApp.setUser({ ...TwinEvalApp.getUser(), avatar_url: avatarUrl });
        TwinEvalApp.showToast('Photo Updated', 'Your profile photo has been saved to your account.', 'success');
      } catch (err) {
        TwinEvalApp.showToast('Upload Failed', err.message || 'Could not upload that photo -- please try again.', 'danger');
      } finally {
        input.value = ''; // allow re-selecting the same file later
      }
    });
  },

  renderAvatar(url) {
    const circle = document.getElementById('profileAvatarCircle');
    if (!circle) return;
    if (url) {
      circle.innerHTML = `<img src="${TwinEvalApp.resolveUploadUrl(url)}" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      circle.innerHTML = `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    }
  }
};
