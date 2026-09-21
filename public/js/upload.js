/**
 * TWINEVAL AI - UPLOAD ANSWER MODULE JAVASCRIPT
 */

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('uploadDropzone') || document.querySelector('.upload-page')) {
    UploadModule.init();
  }
});

const UploadModule = {
  selectedFile: null,
  papers: [],

  init() {
    this.initDropzone();
    this.initFormTriggers();
    this.loadPapers();
    this.initPaperSearch();
  },

  async loadPapers() {
    const select = document.getElementById('paperSelect');
    if (!select) return;
    try {
      const res = await TwinEvalApp.apiFetch('/papers');
      this.papers = res.data || [];
      this.renderPaperOptions(this.papers);
    } catch (err) {
      this.papers = [];
      select.innerHTML = `<option value="">Could not load papers: ${err.message}</option>`;
    }
  },

  renderPaperOptions(papers) {
    const select = document.getElementById('paperSelect');
    if (!select) return;
    if (!this.papers.length) {
      select.innerHTML = `<option value="">No published papers yet -- ask your teacher</option>`;
      return;
    }
    if (!papers.length) {
      select.innerHTML = `<option value="">No papers match your search</option>`;
      return;
    }
    select.innerHTML = papers.map(p =>
      `<option value="${p.paper_id}">${p.title} -- ${p.subject}${p.topic ? ' / ' + p.topic : ''} (${p.question_count} question${p.question_count === 1 ? '' : 's'})</option>`
    ).join('');
  },

  /**
   * The header search box ("Search for evaluation, subject, and more")
   * filters the paper-selection dropdown live as the student types,
   * matching against the paper's title, subject, and topic.
   */
  initPaperSearch() {
    const input = document.getElementById('paperSearchInput');
    if (!input) return;
    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        this.renderPaperOptions(this.papers);
        return;
      }
      const filtered = this.papers.filter(p =>
        [p.title, p.subject, p.topic].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
      );
      this.renderPaperOptions(filtered);
    });
  },

  initDropzone() {
    const dropzone = document.getElementById('uploadDropzone');
    const fileInput = document.getElementById('answerFileInput');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        this.handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFileSelect(e.target.files[0]);
      }
    });
  },

  handleFileSelect(file) {
    // Validate file type & size
    const validExtensions = ['pdf', 'png', 'jpg', 'jpeg'];
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (!validExtensions.includes(ext)) {
      TwinEvalApp.showToast('Invalid File Format', 'Please upload a valid PDF, PNG, or JPG document.', 'danger');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      TwinEvalApp.showToast('File Too Large', 'Maximum allowed file size is 25MB.', 'warning');
      return;
    }

    this.selectedFile = file;

    // Display selected file card
    const card = document.getElementById('selectedFileCard');
    const fileName = document.getElementById('selectedFileName');
    const fileSize = document.getElementById('selectedFileSize');
    const startBtn = document.getElementById('startEvaluationBtn');

    if (card && fileName && fileSize) {
      fileName.textContent = file.name;
      fileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB • PDF Document`;
      card.style.display = 'flex';
      card.classList.add('animate-fade-in');
    }

    if (startBtn) {
      startBtn.disabled = false;
      startBtn.classList.remove('btn-disabled');
    }

    TwinEvalApp.showToast('File Uploaded', `${file.name} is ready for AI evaluation.`, 'success');
  },

  initFormTriggers() {
    const startBtn = document.getElementById('startEvaluationBtn');
    const removeBtn = document.getElementById('removeFileBtn');

    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedFile = null;
        const card = document.getElementById('selectedFileCard');
        if (card) card.style.display = 'none';
        if (startBtn) {
          startBtn.disabled = true;
          startBtn.classList.add('btn-disabled');
        }
        const fileInput = document.getElementById('answerFileInput');
        if (fileInput) fileInput.value = '';
        TwinEvalApp.showToast('File Removed', 'Please select another answer sheet.', 'info');
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', () => this.startEvaluation());
    }
  },

  async startEvaluation() {
    const startBtn = document.getElementById('startEvaluationBtn');
    const paperSelect = document.getElementById('paperSelect');
    const paperId = paperSelect ? paperSelect.value : '';

    if (!paperId) {
      TwinEvalApp.showToast('Select a Paper', 'Please choose which question paper you are answering.', 'danger');
      return;
    }
    if (!this.selectedFile) {
      TwinEvalApp.showToast('No File Selected', 'Please choose an answer sheet file first.', 'danger');
      return;
    }

    startBtn.disabled = true;
    this.showProgressCard();
    this.updateProgress({ stage: 'queued', message: 'Uploading your answer sheet...', current: 0, total: 0 });

    const formData = new FormData();
    formData.append('paper_id', paperId);
    formData.append('file', this.selectedFile);

    try {
        const prepForm = new FormData();
        prepForm.append('paper_id', paperId);
        prepForm.append('file', this.selectedFile);
        prepForm.append('local_ai', 'true');

        const prep = await TwinEvalApp.apiFetch('/submissions/generate-job', { method: 'POST', body: prepForm });
        this.submissionId = prep.data.submission_id;

        const aiForm = new FormData();
        aiForm.append('file', this.selectedFile);
        aiForm.append('questions', JSON.stringify(prep.data.ai_questions));
        aiForm.append('answer_keys', JSON.stringify(prep.data.answer_keys));
        aiForm.append('pass_percentage', String(prep.data.pass_percentage));

        const ai = await TwinEvalLocalAI.startJob('/jobs/evaluate-submission', aiForm);
        this.pollJob(ai.job_id);
    } catch (err) {
        this.onEvaluationFailed(err.message || 'Could not start evaluation.');
    }
  },

  // Stage labels mirror exactly what the AI engine reports -- see
  // js/teacher-upload.js for the identical pattern used on the
  // teacher's answer-key generation flow.
  STAGE_LABELS: {
    queued: 'Queued',
    extracting_text: 'Reading Your Answer Sheet (OCR)',
    splitting_answers: 'Matching Answers to Questions',
    evaluating: 'Evaluating Your Answers',
    complete: 'Done',
  },

  // A single transient network hiccup during any one of the many
  // polls over a long evaluation run must not throw away a submission
  // that's still completing successfully in the background -- only
  // give up after several CONSECUTIVE failures. (Identical fix to the
  // one applied to paper generation, same root cause.)
  MAX_CONSECUTIVE_POLL_FAILURES: 6,
  _consecutivePollFailures: 0,
  _pollTimer: null,
  _jobStartedAt: null,
  submissionId: null,

  pollJob(jobId) {
    clearTimeout(this._pollTimer);
    this._consecutivePollFailures = 0;
    this._jobStartedAt = Date.now();

    const tick = async () => {
        try {
            const jobResponse = await TwinEvalLocalAI.getJob(jobId);
            const job = jobResponse.job;
            this._consecutivePollFailures = 0;
            this.updateProgress(job);

            if (!job.done) {
                this._pollTimer = setTimeout(tick, 900);
                return;
            }

            if (job.error) {
                this.onEvaluationFailed(job.error);
                return;
            }

            await this.finalizeSubmission(job.result);
        } catch (err) {
            this._consecutivePollFailures += 1;
            if (this._consecutivePollFailures >= this.MAX_CONSECUTIVE_POLL_FAILURES) {
                this.onEvaluationFailed(
                    (err.message || 'Lost connection while checking progress.') +
                    ' (Evaluation is running on this computer -- check the local AI engine before retrying.)'
                );
                return;
            }
            document.getElementById('progressMessageText').textContent =
                `Connection hiccup, retrying... (${this._consecutivePollFailures}/${this.MAX_CONSECUTIVE_POLL_FAILURES})`;
            this._pollTimer = setTimeout(tick, 1500);
        }
    };

    tick();
  },

  updateProgress(job) {
    document.getElementById('progressStageLabel').textContent = this.STAGE_LABELS[job.stage] || 'Working...';

    let message = job.message || '';
    if (this._jobStartedAt && job.stage !== 'complete') {
        const elapsedSec = Math.round((Date.now() - this._jobStartedAt) / 1000);
        if (elapsedSec >= 60) {
            const mins = Math.floor(elapsedSec / 60);
            const secs = elapsedSec % 60;
            message += ` (${mins}m ${secs}s elapsed -- local AI evaluation, this is expected to take a while for longer papers)`;
        }
    }
    document.getElementById('progressMessageText').textContent = message;

    const countEl = document.getElementById('progressCount');
    const fillEl = document.getElementById('progressFill');
    if (job.total > 0) {
        countEl.textContent = `${job.current} / ${job.total}`;
        fillEl.style.width = `${Math.round((job.current / job.total) * 100)}%`;
    } else {
        countEl.textContent = '';
        fillEl.style.width = job.stage === 'complete' ? '100%' : '8%';
    }
  },

  showProgressCard() {
    const card = document.getElementById('evaluationProgressCard');
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  onEvaluationFailed(message) {
    clearTimeout(this._pollTimer);
    document.getElementById('evaluationProgressCard').hidden = true;
    const startBtn = document.getElementById('startEvaluationBtn');
    startBtn.disabled = false;
    TwinEvalApp.showToast('Evaluation Failed', message, 'danger');

    // Best-effort: tell the backend so the submission row actually
    // reaches a 'failed' state with this real error message, instead
    // of being left stuck in 'processing' forever.
    if (this.submissionId) {
        TwinEvalApp.apiFetch(`/submissions/${this.submissionId}/mark-failed`, {
            method: 'POST',
            body: JSON.stringify({ error: message }),
        }).catch(() => { /* best effort -- nothing more to do if this itself fails */ });
    }
  },

  async finalizeSubmission(result) {
    try {
        await TwinEvalApp.apiFetch(`/submissions/${this.submissionId}/finalize`, {
            method: 'POST',
            body: JSON.stringify({ raw_text: result.raw_text, results: result.results, overall: result.overall })
        });
        TwinEvalApp.showToast('Evaluation Complete', 'Your answer sheet has been graded.', 'success');
        window.location.href = `results.html?submission_id=${this.submissionId}`;
    } catch (err) {
        this.onEvaluationFailed(err.message || 'Could not save the evaluation results.');
    }
  }
};
