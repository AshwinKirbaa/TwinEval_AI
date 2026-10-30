"""
AI Bridge Server -- exposes the existing Python evaluation engine
(OCR via Ollama, question splitting, AI answer-key generation,
rubric-aware evaluation, PDF report generation) as a small REST API
that the Node/Express backend calls over HTTP.

Why a separate Python process instead of rewriting this in Node:
Ollama, OCR (PyMuPDF/PaddleOCR), and the sentence-transformers
embedding model this engine relies on are all Python-native. Rather
than reimplement that stack in JavaScript, Node treats this service as
an internal microservice, the same way it would call any other
third-party API.

Run with:
    pip install -r requirements.txt
    python ai_server.py
Listens on http://localhost:8000 by default (set AI_SERVICE_PORT to
change). Requires a local Ollama with `gemma3:4b` pulled, exactly like
the Streamlit app (app.py) this engine also powers -- both can run
against the same Ollama install without conflict.
"""
import json
import os
import tempfile
import threading
import traceback
import uuid as uuid_lib

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from models.question import AnswerKey, Question
from models.student import Student
from models.teacher import Teacher
from services.paper_evaluation_service import PaperEvaluationService
from utils.file_reader import check_ollama_ready, extract_text
from utils.pdf_generator import generate_full_report_pdf

app = Flask(__name__)
CORS(app)  # the Node backend runs on a different port; allow it to call this service


def _error(message, status=400):
    return jsonify({"success": False, "message": message}), status


@app.errorhandler(Exception)
def handle_any_uncaught_exception(e):
    """
    Safety net: without this, ANY exception that escapes a route's own
    try/except (a bug, an unexpected input, a crash inside a library)
    makes Flask return its default HTML error page instead of JSON.
    When that hits the Node backend, the error message gets silently
    lost (axios can't find a `.message` field on an HTML string), and
    the user only ever sees a generic "X failed." toast with zero
    information about what actually went wrong.

    This guarantees every response -- success or failure -- is JSON
    with a real message, AND prints the full traceback to this
    process's own console, which is the most reliable place to look
    when debugging ("check the ai_server.py terminal window").
    """
    if isinstance(e, HTTPException):
        # Real HTTP errors (404 route not found, 405 wrong method, a
        # request that's too large, etc) -- keep their actual status
        # code and description rather than flattening everything to 500.
        return _error(e.description or str(e), e.code or 500)

    print("=" * 70)
    print("UNHANDLED EXCEPTION IN AI ENGINE:")
    traceback.print_exc()
    print("=" * 70)
    return _error(f"AI engine error: {e}", 500)

TEXT_MODEL = os.environ.get("AI_TEXT_MODEL", "qwen3:4b-instruct")
VISION_MODEL = os.environ.get("AI_VISION_MODEL", "gemma3:4b")

# Built once at process start (loads the sentence-transformer model etc)
# and reused for every request -- mirrors the @st.cache_resource pattern
# used in the Streamlit app, for the same reason: this is expensive to
# rebuild per-request.
_service = PaperEvaluationService(model=TEXT_MODEL)


class _WerkzeugFileAdapter:
    """
    utils.file_reader.extract_text() expects a file-like object with a
    `.name` attribute (it checks the extension) plus `.seek()`/`.read()`
    (as Streamlit's UploadedFile provides). Flask's FileStorage has
    `.filename` instead of `.name` -- this tiny adapter bridges that
    gap without touching the existing, already-tested OCR pipeline.
    """
    def __init__(self, file_storage):
        self._fs = file_storage
        self.name = file_storage.filename or "upload"

    def seek(self, *args, **kwargs):
        return self._fs.stream.seek(*args, **kwargs)

    def read(self, *args, **kwargs):
        return self._fs.stream.read(*args, **kwargs)

    def getbuffer(self):
        pos = self._fs.stream.tell()
        self._fs.stream.seek(0)
        data = self._fs.stream.read()
        self._fs.stream.seek(pos)
        return data


@app.route("/health", methods=["GET"])
def health():
    text_ok, text_msg = check_ollama_ready(model=TEXT_MODEL)
    vision_ok, vision_msg = check_ollama_ready(model=VISION_MODEL)
    return jsonify({
        "success": True,
        "ollama_ready": text_ok and vision_ok,
        "text_model": TEXT_MODEL,
        "vision_model": VISION_MODEL,
        "message": text_msg if not text_ok else vision_msg
    })


# -------------------------------------------------------------------
# Background job system for paper generation (OCR -> split questions ->
# generate answer keys). A single blocking HTTP request for this whole
# pipeline gives the caller zero visibility into what's happening for
# however long it takes -- this exposes real, live per-step progress
# (mirroring the same progress the Streamlit app already showed, e.g.
# "Generating answer key for question 3 of 8...") over plain polling,
# without needing WebSockets/SSE plumbing through the Node backend.
# -------------------------------------------------------------------
_jobs = {}
_jobs_lock = threading.Lock()


def _set_job(job_id, **fields):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def _new_job(job_id):
    with _jobs_lock:
        _jobs[job_id] = {
            "done": False, "error": None, "stage": "queued",
            "current": 0, "total": 0, "message": "Queued...", "result": None,
        }


def _run_paper_generation_job(job_id, raw_text, topic, default_max_marks):
    try:
        _set_job(job_id, stage="splitting_questions",
                  message="Splitting the question paper into individual questions...")
        questions = _service.build_questions_from_text(raw_text, topic=topic, default_max_marks=default_max_marks)

        if not questions:
            _set_job(job_id, done=True, error="Could not identify any questions in the provided text.")
            return

        total = len(questions)
        _set_job(job_id, stage="generating_keys", current=0, total=total,
                  message=f"Found {total} question(s). Generating AI answer keys...")

        def _progress(current, total_count, stage):
            if stage == "generating":
                _set_job(job_id, current=current, total=total_count,
                          message=f"Generating answer key for question {current} of {total_count}...")

        answer_keys = _service.generate_answer_keys(questions, progress_callback=_progress)

        _set_job(job_id, done=True, error=None, stage="complete", current=total, total=total,
                  message="Answer key generation complete.",
                  result={"questions": [q.to_dict() for q in questions], "answer_keys": answer_keys})
    except Exception as e:
        print("=" * 70)
        print(f"PAPER GENERATION JOB {job_id} FAILED:")
        traceback.print_exc()
        print("=" * 70)
        _set_job(job_id, done=True, error=str(e))


@app.route("/jobs/generate-paper", methods=["POST"])
def create_generate_paper_job():
    """
    Starts a background job that: (1) OCRs an uploaded question-paper
    file if one was given, (2) splits the text into questions, (3)
    generates a full AI answer key per question -- with live progress
    trackable via GET /jobs/<job_id>. Returns {job_id} immediately.

    Accepts multipart/form-data: either a 'file' field (question paper
    upload) or a 'raw_text' field (manually typed questions), plus
    optional 'topic' and 'default_max_marks'.
    """
    job_id = uuid_lib.uuid4().hex[:12]
    _new_job(job_id)

    topic = request.form.get("topic", "")
    try:
        default_max_marks = float(request.form.get("default_max_marks", 10.0))
    except (TypeError, ValueError):
        default_max_marks = 10.0

    raw_text = request.form.get("raw_text", "")

    # File reading/OCR must happen HERE (synchronously, inside the
    # request) rather than in the background thread -- Flask's request
    # object (and the uploaded file stream) isn't valid anymore once
    # this request handler returns.
    if "file" in request.files and request.files["file"].filename:
        file_storage = request.files["file"]
        filename_lower = file_storage.filename.lower()
        needs_possible_ocr = filename_lower.endswith((".pdf", ".png", ".jpg", ".jpeg"))
        if needs_possible_ocr:
            ok, msg = check_ollama_ready(model=VISION_MODEL)
            if not ok:
                _set_job(job_id, done=True, error=msg)
                return jsonify({"success": True, "job_id": job_id})

        _set_job(job_id, stage="extracting_text", message="Reading the uploaded question paper...")
        try:
            adapted = _WerkzeugFileAdapter(file_storage)
            raw_text = extract_text(adapted, ocr_model=VISION_MODEL)
        except Exception as e:
            _set_job(job_id, done=True, error=f"Text extraction failed: {e}")
            return jsonify({"success": True, "job_id": job_id})

    if not raw_text or not raw_text.strip():
        _set_job(job_id, done=True,
                  error="No question text found -- provide raw_text or upload a readable question paper file.")
        return jsonify({"success": True, "job_id": job_id})

    # Answer-key generation always has a working fallback path (Gemini
    # first if GEMINI_API_KEY is set, then local Ollama) -- but if
    # Gemini isn't configured, Ollama is the ONLY path, so fail fast
    # here with a clear, actionable message instead of silently
    # discovering it's unreachable partway through generating keys for
    # question 1 of N (which, before the ollama_client timeout fix,
    # could otherwise hang the whole job with no feedback at all).
    if not os.environ.get("GEMINI_API_KEY"):
        ok, msg = check_ollama_ready(model=TEXT_MODEL)
        if not ok:
            _set_job(job_id, done=True, error=msg)
            return jsonify({"success": True, "job_id": job_id})

    thread = threading.Thread(
        target=_run_paper_generation_job, args=(job_id, raw_text, topic, default_max_marks), daemon=True
    )
    thread.start()

    return jsonify({"success": True, "job_id": job_id})


def _run_submission_evaluation_job(job_id, raw_text, questions, answer_keys, pass_percentage):
    try:
        _set_job(job_id, stage="splitting_answers", message="Matching your answers to each question...")
        student_answers = _service.split_student_answers(raw_text, questions)

        total = len(questions)
        _set_job(job_id, stage="evaluating", current=0, total=total,
                  message=f"Evaluating {total} question(s)...")

        def _progress(current, total_count, stage):
            if stage == "evaluating":
                _set_job(job_id, current=current, total=total_count,
                          message=f"Evaluating question {current} of {total_count}...")

        results = _service.evaluate_all(
            questions, answer_keys, student_answers, progress_callback=_progress, pass_percentage=pass_percentage
        )
        overall = _service.build_overall_report(results, pass_percentage=pass_percentage)

        _set_job(job_id, done=True, error=None, stage="complete", current=total, total=total,
                  message="Evaluation complete.",
                  result={"raw_text": raw_text, "results": results, "overall": overall})
    except Exception as e:
        print("=" * 70)
        print(f"SUBMISSION EVALUATION JOB {job_id} FAILED:")
        traceback.print_exc()
        print("=" * 70)
        _set_job(job_id, done=True, error=str(e))


@app.route("/jobs/evaluate-submission", methods=["POST"])
def create_evaluate_submission_job():
    """
    Starts a background job that: (1) OCRs the uploaded answer sheet,
    (2) splits it into per-question answers, (3) evaluates each answer
    against its answer key -- with live progress trackable via
    GET /jobs/<job_id>. Returns {job_id} immediately.

    This mirrors /jobs/generate-paper for the exact same reason: one
    long blocking HTTP request covering OCR + N evaluation calls (each
    a real local LLM call) is fragile against normal network hiccups
    and request timeouts over however many minutes that takes. Running
    it as a background job with resilient client-side polling (see the
    Node/frontend side) fixes that.

    Accepts multipart/form-data:
      - 'file': the answer sheet (required)
      - 'questions': JSON-encoded list of Question dicts (required)
      - 'answer_keys': JSON-encoded {question_id: AnswerKey dict} (required)
      - 'pass_percentage': optional, default 40.0
    """
    job_id = uuid_lib.uuid4().hex[:12]
    _new_job(job_id)

    if "file" not in request.files or not request.files["file"].filename:
        _set_job(job_id, done=True, error="An answer sheet file is required.")
        return jsonify({"success": True, "job_id": job_id})

    try:
        questions_raw = json.loads(request.form.get("questions", "[]"))
        answer_keys = json.loads(request.form.get("answer_keys", "{}"))
    except (ValueError, TypeError) as e:
        _set_job(job_id, done=True, error=f"Invalid questions/answer_keys payload: {e}")
        return jsonify({"success": True, "job_id": job_id})

    if not questions_raw:
        _set_job(job_id, done=True, error="This question paper has no questions.")
        return jsonify({"success": True, "job_id": job_id})

    try:
        pass_percentage = float(request.form.get("pass_percentage", 40.0))
    except (TypeError, ValueError):
        pass_percentage = 40.0

    # Evaluation (topic-relevance gate + holistic rubric scoring) always
    # goes through the local Ollama model -- unlike answer-key
    # generation there is no Gemini fallback here. Fail fast with a
    # clear, actionable message now rather than have the background
    # worker discover Ollama is unreachable only after OCR has already
    # run (or, before the ollama_client timeout fix, potentially hang
    # indefinitely on the first evaluation call with zero feedback).
    ok, msg = check_ollama_ready(model=TEXT_MODEL)
    if not ok:
        _set_job(job_id, done=True, error=msg)
        return jsonify({"success": True, "job_id": job_id})

    questions = [Question.from_dict(q) for q in questions_raw]

    # IMPORTANT: do not OCR here. The old implementation performed the
    # entire PDF/image OCR step before returning the job id, which made
    # the browser look frozen on "Uploading..." for scanned answer sheets.
    # Save the upload to a private temporary file, return the job id
    # immediately, and let the background worker do OCR + evaluation.
    file_storage = request.files["file"]
    suffix = os.path.splitext(file_storage.filename or "upload")[1].lower() or ".bin"
    temp_fd, temp_path = tempfile.mkstemp(prefix="twineval-answer-", suffix=suffix)
    os.close(temp_fd)
    try:
        file_storage.save(temp_path)
    except Exception as e:
        _safe_remove_temp = False
        try:
            os.remove(temp_path)
        except Exception:
            pass
        _set_job(job_id, done=True, error=f"Could not save uploaded answer sheet: {e}")
        return jsonify({"success": True, "job_id": job_id})

    def _run_saved_submission_job():
        try:
            filename = file_storage.filename or os.path.basename(temp_path)
            filename_lower = filename.lower()
            needs_possible_ocr = filename_lower.endswith((".pdf", ".png", ".jpg", ".jpeg"))

            if needs_possible_ocr:
                ok, msg = check_ollama_ready(model=VISION_MODEL)
                if not ok:
                    _set_job(job_id, done=True, error=msg)
                    return

            _set_job(job_id, stage="extracting_text", message="Reading your answer sheet (OCR)...")
            with open(temp_path, "rb") as saved_file:
                raw_text = extract_text(saved_file, ocr_model=VISION_MODEL)

            if not raw_text or not raw_text.strip():
                _set_job(job_id, done=True, error="No text could be extracted from the uploaded answer sheet.")
                return

            _run_submission_evaluation_job(
                job_id, raw_text, questions, answer_keys, pass_percentage
            )
        except Exception as e:
            print("=" * 70)
            print(f"SUBMISSION OCR/EVALUATION JOB {job_id} FAILED:")
            traceback.print_exc()
            print("=" * 70)
            _set_job(job_id, done=True, error=str(e))
        finally:
            try:
                os.remove(temp_path)
            except Exception:
                pass

    thread = threading.Thread(target=_run_saved_submission_job, daemon=True)
    thread.start()

    return jsonify({"success": True, "job_id": job_id})


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return _error("Job not found (it may have expired or the server restarted).", 404)
    return jsonify({"success": True, "job": job})


@app.route("/extract-text", methods=["POST"])
def extract_text_route():
    """multipart/form-data with a single 'file' field (question paper or
    answer sheet, PDF/DOCX/TXT/PNG/JPG). Returns the extracted text."""
    if "file" not in request.files:
        return _error("No 'file' part in the request.")
    file_storage = request.files["file"]
    if not file_storage or not file_storage.filename:
        return _error("Empty file upload.")

    filename_lower = file_storage.filename.lower()
    needs_possible_ocr = filename_lower.endswith((".pdf", ".png", ".jpg", ".jpeg"))
    if needs_possible_ocr:
        ok, msg = check_ollama_ready(model=VISION_MODEL)
        if not ok:
            return _error(msg, 503)

    try:
        adapted = _WerkzeugFileAdapter(file_storage)
        text = extract_text(adapted, ocr_model=VISION_MODEL)
        return jsonify({"success": True, "text": text})
    except Exception as e:
        return _error(f"Text extraction failed: {e}", 500)


@app.route("/split-questions", methods=["POST"])
def split_questions_route():
    """JSON: {raw_text, topic?, default_max_marks?} -> list of Question dicts."""
    data = request.get_json(force=True) or {}
    raw_text = data.get("raw_text", "")
    if not raw_text.strip():
        return _error("raw_text is required.")

    topic = data.get("topic", "")
    default_max_marks = float(data.get("default_max_marks", 10.0))

    questions = _service.build_questions_from_text(raw_text, topic=topic, default_max_marks=default_max_marks)
    return jsonify({"success": True, "questions": [q.to_dict() for q in questions]})


@app.route("/generate-answer-keys", methods=["POST"])
def generate_answer_keys_route():
    """JSON: {questions: [Question dict, ...]} -> {question_id: AnswerKey dict}."""
    data = request.get_json(force=True) or {}
    question_dicts = data.get("questions", [])
    if not question_dicts:
        return _error("questions is required and must be non-empty.")

    ok, msg = check_ollama_ready(model=TEXT_MODEL)
    if not ok:
        return _error(msg, 503)

    questions = [Question.from_dict(q) for q in question_dicts]
    answer_keys = _service.generate_answer_keys(questions)
    return jsonify({"success": True, "answer_keys": answer_keys})


@app.route("/split-answers", methods=["POST"])
def split_answers_route():
    """JSON: {raw_text, questions: [Question dict, ...]} -> {question_id: answer_text}."""
    data = request.get_json(force=True) or {}
    raw_text = data.get("raw_text", "")
    question_dicts = data.get("questions", [])
    if not raw_text.strip() or not question_dicts:
        return _error("raw_text and questions are required.")

    questions = [Question.from_dict(q) for q in question_dicts]
    split = _service.split_student_answers(raw_text, questions)
    return jsonify({"success": True, "answers": split})


@app.route("/evaluate", methods=["POST"])
def evaluate_route():
    """
    JSON: {
        questions: [Question dict, ...],
        answer_keys: {question_id: AnswerKey dict, ...},
        student_answers: {question_id: answer_text, ...},
        pass_percentage?: number
    }
    -> {results: [...], overall: {...}}
    """
    data = request.get_json(force=True) or {}
    question_dicts = data.get("questions", [])
    answer_keys = data.get("answer_keys", {})
    student_answers = data.get("student_answers", {})
    pass_percentage = float(data.get("pass_percentage", 40.0))

    if not question_dicts:
        return _error("questions is required.")

    ok, msg = check_ollama_ready(model=TEXT_MODEL)
    if not ok:
        return _error(msg, 503)

    questions = [Question.from_dict(q) for q in question_dicts]
    results = _service.evaluate_all(questions, answer_keys, student_answers, pass_percentage=pass_percentage)
    overall = _service.build_overall_report(results, pass_percentage=pass_percentage)
    return jsonify({"success": True, "results": results, "overall": overall})


@app.route("/generate-report-pdf", methods=["POST"])
def generate_report_pdf_route():
    """
    JSON: {student: {...}, teacher: {...}, questions: [...], results: [...], overall: {...}}
    -> the generated PDF file.
    """
    data = request.get_json(force=True) or {}
    try:
        student = Student(**data["student"])
        teacher = Teacher(**data["teacher"])
        questions = [Question.from_dict(q) for q in data.get("questions", [])]
        results = data.get("results", [])
        overall = data.get("overall", {})
    except (KeyError, TypeError) as e:
        return _error(f"Missing/invalid field for report generation: {e}")

    try:
        pdf_path = generate_full_report_pdf(student, teacher, questions, results, overall)
        return send_file(pdf_path, mimetype="application/pdf", as_attachment=True,
                          download_name=os.path.basename(pdf_path))
    except Exception as e:
        return _error(f"PDF generation failed: {e}", 500)


@app.route("/flags", methods=["GET"])
def list_flags_route():
    status = request.args.get("status", "open")
    return jsonify({"success": True, "flags": _service.list_flags(status=status)})


@app.route("/flags", methods=["POST"])
def create_flag_route():
    data = request.get_json(force=True) or {}
    question = data.get("question", {})
    result = data.get("result", {})
    reason = data.get("reason", "")
    flag_id = _service.flag_for_review(question, result, reason=reason, flagged_by=data.get("flagged_by", ""))
    return jsonify({"success": True, "flag_id": flag_id})


@app.route("/flags/<flag_id>/resolve", methods=["POST"])
def resolve_flag_route(flag_id):
    data = request.get_json(force=True) or {}
    _service.resolve_flag(flag_id, teacher_marks=float(data.get("teacher_marks", 0)),
                           teacher_reason=data.get("teacher_reason", ""))
    return jsonify({"success": True})


if __name__ == "__main__":
    port = int(os.environ.get("AI_SERVICE_PORT", "8000"))
    host = os.environ.get("AI_SERVICE_HOST", "127.0.0.1")
    print(f"AI Bridge Server starting on http://{host}:{port}")
    print(f"Using text model: {TEXT_MODEL}")
    print(f"Using vision/OCR model: {VISION_MODEL}")
    # threaded=True: without this, Werkzeug's dev server handles one
    # request at a time. A long-running background generation job
    # (spawned in its own thread, not blocked by this) is fine either
    # way, but the poll requests checking on it need the server to stay
    # responsive throughout -- threaded mode ensures that.
    app.run(host=host, port=port, debug=False, threaded=True)
