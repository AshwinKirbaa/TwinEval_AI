# TwinEval AI V3 Fixes

## Header interactions
- Top-right account pill is a real accessible dropdown.
- Clicking outside or Escape closes menus.
- Opening one dropdown closes the other.
- Profile/Settings links work.
- Sign out works.
- Theme toggles between light and dark and persists in localStorage.
- Settings page dark-mode checkbox stays synchronized with the global theme.
- Notifications are loaded from real submissions rather than a static empty panel.
- Processing, completed, reviewed, and failed submissions appear in the notification menu.

## Evaluation pipeline
Two bugs that could leave an evaluation apparently stuck/failing were fixed:

1. The Python evaluation job was doing OCR synchronously before returning its job id. A scanned multi-page PDF could therefore leave the browser on "Uploading..." for a long time. The upload is now saved to a temporary file, the job id is returned immediately, and OCR/evaluation runs in the background worker.

2. The Node finalize/mark-failed handlers checked `req.user.student_id`, but the JWT contains the user id rather than the student id. A completed AI job could therefore be rejected during finalization and marked as failed. Ownership is now resolved through `StudentModel.findByUserId(req.user.user_id)`.

The AI engine remains real Ollama + OCR + answer splitting + rubric evaluation; no fake completion states were added.
