/**
 * TWINEVAL AI - SETTINGS MODULE JAVASCRIPT
 */

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.settings-page') || document.getElementById('settingsSaveBtn')) {
    SettingsModule.init();
  }
});

const SettingsModule = {
  init() {
    this.initTabNavigation();
    this.initSettingsSave();
    this.initAccountDeletion();
  },

  initTabNavigation() {
    const tabNavBtns = document.querySelectorAll('.settings-tab-btn');
    const tabSections = document.querySelectorAll('.settings-section');

    tabNavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');

        tabNavBtns.forEach(b => b.classList.remove('active'));
        tabSections.forEach(s => s.classList.remove('active'));

        btn.classList.add('active');
        const activeSection = document.getElementById(target);
        if (activeSection) {
          activeSection.classList.add('active');
        }
      });
    });
  },

  initSettingsSave() {
    const saveBtn = document.getElementById('settingsSaveBtn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', () => {
      TwinEvalApp.showToast('Preferences Saved', 'All system & interface preferences updated.', 'success');
    });
  },

  initAccountDeletion() {
    const dialog = document.getElementById('deleteAccountDialog');
    const openBtn = document.getElementById('openDeleteAccountBtn');
    const cancelBtn = document.getElementById('cancelDeleteAccountBtn');
    const form = document.getElementById('deleteAccountForm');
    const confirmBtn = document.getElementById('confirmDeleteAccountBtn');
    if (!dialog || !openBtn || !form) return;

    openBtn.addEventListener('click', () => {
      form.reset();
      dialog.showModal();
    });
    cancelBtn.addEventListener('click', () => dialog.close());

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const password = document.getElementById('deleteAccountPassword').value;
      const confirmation = document.getElementById('deleteAccountConfirmation').value.trim();
      if (confirmation !== 'DELETE') {
        TwinEvalApp.showToast('Confirmation Required', 'Type DELETE exactly to confirm account deletion.', 'danger');
        return;
      }

      const originalHtml = confirmBtn.innerHTML;
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Deleting...';
      try {
        await TwinEvalApp.apiFetch('/auth/account', {
          method: 'DELETE',
          body: JSON.stringify({ password })
        });
        dialog.close();
        TwinEvalApp.setToken(null);
        localStorage.removeItem('twineval_user');
        TwinEvalApp.showToast('Account Deleted', 'Your account and associated data were permanently deleted.', 'success');
        setTimeout(() => { window.location.href = 'index.html'; }, 1200);
      } catch (error) {
        TwinEvalApp.showToast('Deletion Failed', error.message || 'Your account was not deleted.', 'danger');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalHtml;
      }
    });
  }
};
