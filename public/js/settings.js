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
  }
};
