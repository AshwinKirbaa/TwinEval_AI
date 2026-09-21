"""
AI Paper Evaluation System -- Streamlit UI (redesigned).

This is the ONLY file replaced by the redesign. Every underlying module
it depends on (OCR pipeline, agents, services, PDF generation, JSON
database) is unchanged / additive, so nothing here breaks existing
APIs -- see the individual modules for details:

  - utils/file_reader.py            OCR pipeline (Ollama-first, PaddleOCR/
                                     Gemini fallback) -- untouched.
  - services/paper_evaluation_service.py
                                     Orchestrates question splitting ->
                                     AI answer-key generation -> student
                                     answer splitting -> per-question
                                     evaluation -> overall report.
  - agents/question_agent.py        Splits question-paper text into
                                     individual Question objects.
  - agents/answer_key_agent.py      Generates a full structured
                                     AnswerKey per question via Ollama.
  - agents/student_answer_agent.py  Splits a student's OCR'd submission
                                     into per-question answers.
  - agents/answer_evaluation_agent.py
                                     Scores a single answer against its
                                     AnswerKey (topic-relevance gated).
  - agents/database/database.py     Offline JSON key/value store used
                                     to persist question papers + answer
                                     keys so students can load them by
                                     Paper ID.
  - utils/pdf_generator.py          generate_full_report_pdf() builds
                                     the downloadable report.

The original single-answer-key modules (agents/ollama_vision_agent.py,
services/evaluation_service.py, utils/pdf_generator.generate_pdf) are
left fully intact and importable -- they're just no longer wired into
this UI, per the redesign requirements (manual answer-key entry has
been replaced by AI-generated answer keys from a question).
"""
import os
from datetime import datetime

import streamlit as st

from agents.database import database
from models.question import Question
from models.student import Student
from models.teacher import Teacher
from services.paper_evaluation_service import PaperEvaluationService
from utils.file_reader import check_ollama_ready, extract_text
from utils.pdf_generator import generate_full_report_pdf

# -------------------------------------------------
# Page Configuration
# -------------------------------------------------

st.set_page_config(
    page_title="AI Paper Evaluation System",
    page_icon="📝",
    layout="wide",
)

OCR_MODEL = "gemma3:4b"


# -------------------------------------------------
# Cached, expensive-to-build resources
# -------------------------------------------------
# PaperEvaluationService pulls in ConceptAgent (loads a SentenceTransformer
# model) among others -- rebuilding it on every Streamlit rerun would be
# very slow, so it's built once per server process and reused.

@st.cache_resource(show_spinner="🧠 Loading AI evaluation engine (first run only)...")
def get_paper_service() -> PaperEvaluationService:
    return PaperEvaluationService(model=OCR_MODEL)


# -------------------------------------------------
# Shared OCR helper (multi-page PDF / multi-file, with live progress)
# -------------------------------------------------

def extract_text_with_progress(uploaded_file, label: str) -> str:
    """
    Runs extract_text() while showing a live progress bar for multi-page
    OCR. Each scanned/handwritten page is processed one at a time by the
    local Ollama vision model (utils/file_reader.py decides per page
    whether OCR is actually needed -- typed pages skip straight to the
    embedded text layer).
    """
    filename = uploaded_file.name.lower()
    needs_possible_ocr = filename.endswith((".pdf", ".png", ".jpg", ".jpeg"))

    # NOTE: we deliberately do NOT check Ollama readiness here. A typed
    # PDF (the common case for a question paper) is read straight from
    # its embedded text layer and never touches Ollama at all -- gating
    # every upload on Ollama being installed/running would make typed
    # PDFs fail to extract for no reason. The readiness check instead
    # happens lazily inside extract_text_from_image_path(), only for a
    # page/image that genuinely needs OCR.
    progress_bar = st.progress(0.0) if needs_possible_ocr else None
    status_text = st.empty() if needs_possible_ocr else None

    def _progress_callback(current, total, stage):
        if not progress_bar:
            return
        progress_bar.progress(current / total)
        if stage == "ocr_start":
            status_text.info(f"🧠 OCR (Ollama '{OCR_MODEL}') — page {current}/{total} of {label}...")
        elif stage == "text":
            status_text.write(f"📄 Read text layer directly — page {current}/{total} of {label}.")
        elif stage == "ocr_done":
            status_text.write(f"✅ OCR done — page {current}/{total} of {label}.")

    try:
        return extract_text(uploaded_file, progress_callback=_progress_callback, ocr_model=OCR_MODEL)
    finally:
        if progress_bar:
            progress_bar.empty()
        if status_text:
            status_text.empty()


def extract_text_from_many(uploaded_files, label_prefix: str) -> str:
    """
    Runs extract_text_with_progress() over a list of uploaded files
    (multi-page PDFs and/or multiple images) and concatenates the
    results in upload order, each clearly separated so downstream
    question-splitting can still find question/answer markers that
    happen to fall across a file boundary.
    """
    chunks = []
    total_files = len(uploaded_files)
    for idx, f in enumerate(uploaded_files, start=1):
        st.caption(f"📎 Processing file {idx}/{total_files}: **{f.name}**")
        text = extract_text_with_progress(f, f"{label_prefix} — {f.name}")
        if text and text.strip():
            chunks.append(text.strip())
        else:
            st.warning(f"⚠️ No text could be extracted from **{f.name}**.")
    return "\n\n".join(chunks)


# -------------------------------------------------
# Small formatting helpers
# -------------------------------------------------

def _bullets(items, empty_text="None"):
    items = items or []
    if not items:
        st.caption(empty_text)
        return
    for item in items:
        st.write(f"• {item}")


def _paper_display_name(paper_id: str, meta: dict) -> str:
    subject = meta.get("subject") or "General"
    topic = meta.get("topic") or ""
    n_q = len(meta.get("questions", []))
    label = f"{paper_id}  —  {subject}"
    if topic:
        label += f" / {topic}"
    label += f"  ({n_q} question{'s' if n_q != 1 else ''})"
    return label


# -------------------------------------------------
# Sidebar: mode switch
# -------------------------------------------------

st.title("📝 AI Paper Evaluation System")
st.caption("Offline-first · Streamlit + Ollama · AI-generated answer keys · OCR for handwritten/printed submissions")

mode = st.sidebar.radio(
    "Mode",
    [
        "👨‍🏫 Teacher — Create Question Paper & Answer Key",
        "🧑‍🎓 Student — Submit Answers & Get Evaluated",
        "🩺 Review Queue — Verify Flagged Evaluations",
    ],
)

with st.sidebar.expander("ℹ️ About this workflow", expanded=False):
    st.write(
        "**Teacher:** enter or upload the question paper. The system generates a "
        "complete AI answer key per question (model answer, keywords, concepts, "
        "rubric, etc.) and saves it under a Paper ID.\n\n"
        "**Student:** load a saved Paper ID, upload the answer sheet (handwritten "
        "or printed, any number of pages/images), and get a full per-question and "
        "overall evaluation report.\n\n"
        "**Review Queue:** results near the pass/fail line, with low AI confidence, "
        "or manually flagged get queued here. Enter the correct marks once and the "
        "system remembers it as a worked example for future grading (a lightweight "
        "calibration/feedback loop, no retraining needed)."
    )

st.sidebar.markdown("---")
pass_percentage = st.sidebar.slider("Pass percentage threshold", min_value=20, max_value=80, value=40, step=5)

service = get_paper_service()


# ==================================================
# TEACHER MODULE
# ==================================================

if mode.startswith("👨‍🏫"):

    st.header("👨‍🏫 Teacher — Question Paper & AI Answer Key")

    col1, col2 = st.columns(2)
    with col1:
        teacher_name = st.text_input("Teacher Name", value="Dr. Smith")
        subject = st.text_input("Subject", value="Computer Networks")
    with col2:
        topic = st.text_input("Topic (optional)", value="", placeholder="e.g. OSI Model")
        default_max_marks = st.number_input("Default marks per question", min_value=0.5, max_value=100.0, value=10.0, step=0.5)

    default_paper_id = f"{subject.strip() or 'subject'}_{datetime.now().strftime('%Y%m%d')}".replace(" ", "_")
    paper_id = st.text_input(
        "📌 Paper ID (students will use this to load your question paper)",
        value=st.session_state.get("teacher_paper_id", default_paper_id),
    )
    st.session_state["teacher_paper_id"] = paper_id

    st.markdown("---")

    # -------------------------------------------------
    # 1. Question Input
    # -------------------------------------------------
    st.subheader("📄 Question Input")

    question_source = st.radio(
        "How would you like to provide the question(s)?",
        ["✍️ Manual entry", "📤 Upload question paper (PDF/Image, multi-page supported)"],
        horizontal=True,
    )

    raw_question_text = ""

    if question_source.startswith("✍️"):
        raw_question_text = st.text_area(
            "Type one or more questions. For multiple questions, number them "
            "(e.g. '1. Explain the OSI model...' / '2. What is normalization?').",
            height=180,
            placeholder="1. Explain the OSI model with a neat diagram.\n2. What are the advantages of database normalization?",
            key="manual_question_text",
        )
    else:
        qp_files = st.file_uploader(
            "Upload question paper file(s) (PDF, PNG, JPG, JPEG)",
            type=["pdf", "png", "jpg", "jpeg"],
            accept_multiple_files=True,
            key="question_paper_upload",
        )
        if qp_files:
            qp_file_id = "|".join(f"{f.name}_{f.size}" for f in qp_files)
            if st.session_state.get("last_qp_file_id") != qp_file_id:
                try:
                    with st.spinner("📄 Reading question paper..."):
                        extracted_text = extract_text_from_many(qp_files, "question paper")
                    st.session_state["qp_extracted_text"] = extracted_text
                    st.session_state["last_qp_file_id"] = qp_file_id
                    # IMPORTANT: the text_area below is created with
                    # key="qp_text_area". Once a widget with that key has
                    # rendered once, Streamlit ignores any `value=` passed
                    # to it on later reruns and uses
                    # st.session_state["qp_text_area"] instead -- so that's
                    # the ONLY way to actually push freshly extracted text
                    # into the box. Setting it here, before the widget
                    # below is created, is required or the box will stay
                    # stuck showing whatever it showed the very first time
                    # it was ever rendered (typically empty).
                    st.session_state["qp_text_area"] = extracted_text
                    if extracted_text.strip():
                        st.success("✅ Question paper text extracted.")
                    else:
                        st.warning("No text could be extracted from the uploaded file(s).")
                except Exception as e:
                    st.error(f"Error reading question paper: {e}")

        raw_question_text = st.text_area(
            "Extracted question paper text (you can edit before splitting)",
            height=180,
            key="qp_text_area",
        )

    if st.button("🧩 Split into Questions", type="primary", use_container_width=False):
        text_to_split = raw_question_text.strip()
        if not text_to_split:
            st.error("⚠️ Please enter or upload at least one question first.")
        else:
            questions = service.build_questions_from_text(text_to_split, topic=topic, default_max_marks=default_max_marks)
            st.session_state["teacher_questions"] = questions
            st.session_state.pop("teacher_answer_keys", None)  # invalidate stale keys
            st.success(f"✅ Found {len(questions)} question(s).")

    questions = st.session_state.get("teacher_questions", [])

    # -------------------------------------------------
    # 2. Review / edit split questions
    # -------------------------------------------------
    if questions:
        st.markdown("---")
        st.subheader("📝 Review Questions")
        st.caption("Edit the text or per-question marks if the auto-split needs correcting.")

        edited_questions = []
        for i, q in enumerate(questions, start=1):
            with st.expander(f"Question {i}  ·  {q.max_marks:g} marks", expanded=False):
                new_text = st.text_area("Question text", value=q.text, key=f"q_text_{q.id}", height=80)
                c1, c2 = st.columns(2)
                with c1:
                    new_marks = st.number_input("Max marks", min_value=0.5, max_value=100.0, value=float(q.max_marks), step=0.5, key=f"q_marks_{q.id}")
                with c2:
                    new_topic = st.text_input("Topic", value=q.topic, key=f"q_topic_{q.id}")
                edited_questions.append(Question(id=q.id, text=new_text, topic=new_topic, max_marks=new_marks, source=q.source))

        if st.button("💾 Apply Edits"):
            st.session_state["teacher_questions"] = edited_questions
            questions = edited_questions
            st.success("Edits applied.")

        # -------------------------------------------------
        # 3. Generate AI Answer Key(s)
        # -------------------------------------------------
        st.markdown("---")
        st.subheader("🤖 AI Answer Key Generation")

        if st.button("🤖 Generate Answer Key(s)", type="primary"):
            ok, msg = check_ollama_ready(model=OCR_MODEL)
            if not ok:
                st.error(f"⚠️ {msg}")
            else:
                progress_bar = st.progress(0.0)
                status = st.empty()

                def _gen_progress(current, total, stage):
                    progress_bar.progress(current / total)
                    if stage == "generating":
                        status.info(f"✍️ Generating answer key for question {current}/{total}...")

                with st.spinner("Generating AI answer keys..."):
                    answer_keys = service.generate_answer_keys(questions, progress_callback=_gen_progress)

                progress_bar.empty()
                status.empty()
                st.session_state["teacher_answer_keys"] = answer_keys
                st.success("✅ Answer key(s) generated.")

        answer_keys = st.session_state.get("teacher_answer_keys", {})

        # -------------------------------------------------
        # 4. Preview Generated Answer Key(s)
        # -------------------------------------------------
        if answer_keys:
            st.markdown("---")
            st.subheader("👁️ Preview Generated Answer Key(s)")

            for i, q in enumerate(questions, start=1):
                ak = answer_keys.get(q.id, {})
                with st.expander(f"📘 Answer Key — Question {i}: {q.text[:70]}{'...' if len(q.text) > 70 else ''}", expanded=(i == 1)):
                    st.markdown("**Model Answer**")
                    st.write(ak.get("model_answer") or "_Not generated._")

                    c1, c2, c3 = st.columns(3)
                    with c1:
                        st.markdown("**Keywords**")
                        _bullets(ak.get("keywords"))
                        st.markdown("**Concepts**")
                        _bullets(ak.get("concepts"))
                    with c2:
                        st.markdown("**Expected Points**")
                        _bullets(ak.get("expected_points"))
                        st.markdown("**Steps / Algorithm**")
                        _bullets(ak.get("steps"))
                    with c3:
                        st.markdown("**Advantages**")
                        _bullets(ak.get("advantages"))
                        st.markdown("**Disadvantages**")
                        _bullets(ak.get("disadvantages"))

                    c4, c5, c6 = st.columns(3)
                    with c4:
                        st.markdown("**Applications**")
                        _bullets(ak.get("applications"))
                    with c5:
                        st.markdown("**Formulae**")
                        _bullets(ak.get("formulae"))
                    with c6:
                        st.markdown("**Diagrams Required**")
                        _bullets(ak.get("diagrams"))

                    st.markdown(f"**Bloom Level:** {ak.get('bloom_level', 'Understand')}")

                    st.markdown("**Marking Rubric**")
                    rubric = ak.get("rubric") or {}
                    if rubric:
                        st.table({"Criterion": list(rubric.keys()), "Marks": list(rubric.values())})
                    else:
                        st.caption("No rubric generated.")

                    if st.button("🔄 Regenerate this answer key", key=f"regen_{q.id}"):
                        with st.spinner("Regenerating..."):
                            new_ak = service.regenerate_answer_key(q)
                        st.session_state["teacher_answer_keys"][q.id] = new_ak
                        st.rerun()

            # -------------------------------------------------
            # 5. Save Paper + Answer Keys for students to load
            # -------------------------------------------------
            st.markdown("---")
            if st.button("💾 Save Question Paper & Answer Key", type="primary", use_container_width=True):
                if not paper_id.strip():
                    st.error("⚠️ Please provide a Paper ID before saving.")
                else:
                    payload = {
                        "questions": [q.to_dict() for q in questions],
                        "answer_keys": answer_keys,
                        "teacher_name": teacher_name.strip() or "Teacher",
                        "subject": subject.strip() or "General",
                        "topic": topic.strip(),
                        "created_at": datetime.now().isoformat(timespec="seconds"),
                    }
                    database.save(f"paper:{paper_id.strip()}", payload)
                    st.success(f"✅ Saved. Share this Paper ID with students: **{paper_id.strip()}**")


# ==================================================
# STUDENT MODULE
# ==================================================

elif mode.startswith("🧑‍🎓"):

    st.header("🧑‍🎓 Student — Submit Answer Sheet & Get Evaluated")

    # -------------------------------------------------
    # 1. Load a saved question paper
    # -------------------------------------------------
    st.subheader("📂 Load Question Paper")

    available_keys = database.list_keys("paper:")
    available_ids = [k[len("paper:"):] for k in available_keys]

    if not available_ids:
        st.info("No question papers have been saved yet. Ask your teacher to generate and save one first.")
    else:
        chosen_id = st.selectbox(
            "Select the Paper ID your teacher shared",
            options=available_ids,
            format_func=lambda pid: _paper_display_name(pid, database.load(f"paper:{pid}", {}) or {}),
        )

        if st.button("📂 Load Question Paper"):
            paper = database.load(f"paper:{chosen_id}")
            if not paper:
                st.error("Could not load that paper.")
            else:
                st.session_state["student_paper_id"] = chosen_id
                st.session_state["student_paper"] = paper
                st.session_state["student_questions"] = [Question.from_dict(q) for q in paper.get("questions", [])]
                st.session_state["student_answer_keys"] = paper.get("answer_keys", {})
                # Clear any previous submission/results tied to a different paper
                for k in ("student_raw_text", "student_split_answers", "eval_results", "eval_overall", "eval_pdf_path"):
                    st.session_state.pop(k, None)
                st.success(f"✅ Loaded paper **{chosen_id}** with {len(st.session_state['student_questions'])} question(s).")

    student_questions = st.session_state.get("student_questions", [])
    student_answer_keys = st.session_state.get("student_answer_keys", {})
    paper_meta = st.session_state.get("student_paper", {})

    if student_questions:
        with st.expander("📋 Questions in this paper", expanded=False):
            for i, q in enumerate(student_questions, start=1):
                st.write(f"**Q{i}.** {q.text}  _(⁣{q.max_marks:g} marks)_")

        st.markdown("---")

        # -------------------------------------------------
        # 2. Student Information
        # -------------------------------------------------
        st.subheader("🧾 Student Information")
        c1, c2 = st.columns(2)
        with c1:
            student_name = st.text_input("Student Name", value="John Doe")
            register_no = st.text_input("Register Number", value="REG1001")
        with c2:
            department = st.text_input("Department", value="Computer Science")
            semester = st.selectbox("Semester", ["1", "2", "3", "4", "5", "6", "7", "8"], index=5)

        st.markdown("---")

        # -------------------------------------------------
        # 3. Upload Answer Sheet (multi-page / multi-file, OCR progress)
        # -------------------------------------------------
        st.subheader("📤 Upload Answer Sheet")
        st.caption("Handwritten or printed. Multiple pages and/or multiple image files are supported.")

        answer_files = st.file_uploader(
            "Upload answer sheet file(s) (PDF, DOCX, TXT, PNG, JPG, JPEG)",
            type=["pdf", "docx", "txt", "png", "jpg", "jpeg"],
            accept_multiple_files=True,
            key="answer_sheet_upload",
        )

        if answer_files and st.button("📄 Extract Text (OCR)", type="primary"):
            try:
                with st.spinner("Reading and OCR'ing the answer sheet..."):
                    extracted_text = extract_text_from_many(answer_files, "answer sheet")
                st.session_state["student_raw_text"] = extracted_text
                # See the matching note in the teacher block above: seed the
                # text_area's own widget state directly, rather than relying
                # on `value=`, which Streamlit ignores once a widget with
                # this key has been created once (i.e. after the first
                # successful extraction, re-extracting a new file would
                # otherwise leave the old text showing).
                st.session_state["student_raw_text_area"] = extracted_text
                if extracted_text.strip():
                    st.success("✅ Text extracted from all uploaded file(s).")
                else:
                    st.warning("No text could be extracted.")
            except Exception as e:
                st.error(f"Error reading answer sheet: {e}")

        raw_text = st.session_state.get("student_raw_text", "")
        if raw_text:
            raw_text = st.text_area("Extracted answer text (you can correct OCR mistakes before evaluating)", height=220, key="student_raw_text_area")
            st.session_state["student_raw_text"] = raw_text

            if st.button("🧩 Split into Per-Question Answers"):
                split = service.split_student_answers(raw_text, student_questions)
                st.session_state["student_split_answers"] = split
                st.success("✅ Answers matched to questions. Review below before evaluating.")

        split_answers = st.session_state.get("student_split_answers", {})

        if split_answers:
            st.markdown("---")
            st.subheader("✂️ Per-Question Answers (review/edit)")
            edited_answers = {}
            for i, q in enumerate(student_questions, start=1):
                with st.expander(f"Answer to Q{i}", expanded=False):
                    edited_answers[q.id] = st.text_area(
                        "Answer text", value=split_answers.get(q.id, ""), height=120, key=f"ans_{q.id}"
                    )
            if st.button("💾 Save Answer Edits"):
                st.session_state["student_split_answers"] = edited_answers
                split_answers = edited_answers
                st.success("Saved.")

            # -------------------------------------------------
            # 4. Evaluate
            # -------------------------------------------------
            st.markdown("---")
            st.subheader("🧠 Evaluation")

            if st.button("🚀 Evaluate All Answers", type="primary", use_container_width=True):
                ok, msg = check_ollama_ready(model=OCR_MODEL)
                if not ok:
                    st.error(f"⚠️ {msg}")
                else:
                    progress_bar = st.progress(0.0)
                    status = st.empty()

                    def _eval_progress(current, total, stage):
                        progress_bar.progress(current / total)
                        if stage == "evaluating":
                            status.info(f"🧠 Evaluating question {current}/{total}...")

                    with st.spinner("Running AI evaluation..."):
                        results = service.evaluate_all(
                            student_questions, student_answer_keys, split_answers,
                            progress_callback=_eval_progress, pass_percentage=pass_percentage,
                        )
                        overall = service.build_overall_report(results, pass_percentage=pass_percentage)

                    progress_bar.empty()
                    status.empty()

                    st.session_state["eval_results"] = results
                    st.session_state["eval_overall"] = overall
                    st.session_state.pop("eval_pdf_path", None)
                    st.success("✅ Evaluation complete!")

    # -------------------------------------------------
    # 5 & 6. Results + Overall Report
    # -------------------------------------------------
    results = st.session_state.get("eval_results")
    overall = st.session_state.get("eval_overall")

    if results and overall:
        st.markdown("---")
        st.header("📊 Evaluation Report")

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Total Marks", f"{overall['total_marks']:g} / {overall['max_marks']:g}")
        m2.metric("Percentage", f"{overall['percentage']}%")
        m3.metric("Grade", overall["grade"])
        m4.metric("Result", overall["pass_fail"])

        st.markdown("### 🧾 Overall Summary")
        oc1, oc2 = st.columns(2)
        with oc1:
            st.markdown("**Overall Strengths**")
            _bullets(overall.get("overall_strengths"))
            st.markdown("**Frequently Missed Concepts**")
            _bullets(overall.get("frequently_missed_concepts"))
            st.markdown("**Topics to Revise**")
            _bullets(overall.get("topics_to_revise"))
        with oc2:
            st.markdown("**Overall Weaknesses**")
            _bullets(overall.get("overall_weaknesses"))
            st.markdown("**Personalized Recommendations**")
            _bullets(overall.get("recommendations"))
            st.markdown("**Study Suggestions**")
            _bullets(overall.get("study_suggestions"))

        st.markdown("---")
        st.markdown("### 📑 Question-wise Results")

        for i, r in enumerate(results, start=1):
            title = f"Q{i}. {r.get('question_text', '')[:70]}{'...' if len(r.get('question_text', '')) > 70 else ''} — {r.get('marks', 0):g}/{r.get('max_marks', 0):g}"
            if r.get("is_off_topic"):
                title += "  ⚠️ OFF-TOPIC"
            if r.get("needs_review"):
                title += "  🩺 FLAGGED FOR REVIEW"
            with st.expander(title, expanded=(i == 1)):
                if r.get("is_off_topic"):
                    st.error("This answer was flagged as off-topic / addressing the wrong question, and awarded little to no credit regardless of writing quality.")
                if r.get("needs_review"):
                    st.warning(f"🩺 Auto-flagged for human review: {r.get('review_reason', '')}")

                mc1, mc2, mc3, mc4 = st.columns(4)
                mc1.metric("Marks", f"{r.get('marks', 0):g} / {r.get('max_marks', 0):g}")
                mc2.metric("Percentage", f"{r.get('percentage', 0)}%")
                mc3.metric("Grade", r.get("grade", "F"))
                mc4.metric("Bloom Level", r.get("bloom_level", "Understand"))

                st.progress(min(1.0, max(0.0, float(r.get("confidence", 0)) / 100.0)))
                st.caption(f"AI Confidence: {r.get('confidence', 0)}%")

                st.markdown(f"**Feedback:** {r.get('feedback', '')}")

                c1, c2, c3 = st.columns(3)
                with c1:
                    st.markdown("**Found Concepts**")
                    _bullets(r.get("found_concepts"))
                    st.markdown("**Missing Concepts**")
                    _bullets(r.get("missing_concepts"))
                with c2:
                    st.markdown("**Missing Keywords**")
                    _bullets(r.get("missing_keywords"))
                    st.markdown("**Missing Points**")
                    _bullets(r.get("missing_points"))
                with c3:
                    st.markdown("**Missing Diagrams**")
                    _bullets(r.get("missing_diagrams"))

                c4, c5 = st.columns(2)
                with c4:
                    st.markdown("**Strengths**")
                    _bullets(r.get("strengths"))
                with c5:
                    st.markdown("**Areas to Improve**")
                    _bullets(r.get("improvements"))

                st.markdown("**Suggestions**")
                _bullets(r.get("suggestions"))

                if r.get("marks_breakdown"):
                    st.markdown("**Marks Breakdown**")
                    st.table({"Criterion": list(r["marks_breakdown"].keys()), "Marks Earned": list(r["marks_breakdown"].values())})

                if r.get("evidence_map"):
                    with st.expander("🔍 Why these marks? (evidence per criterion)", expanded=False):
                        for criterion, evidence in r["evidence_map"].items():
                            st.markdown(f"**{criterion}:** {evidence or '_not addressed in the answer_'}")

                st.markdown("---")
                flag_key = f"flagged_{r.get('question_id')}"
                if st.session_state.get(flag_key):
                    st.success("🩺 Flagged for teacher review.")
                elif st.button("🚩 Flag for review", key=f"flag_btn_{r.get('question_id')}"):
                    q_dict = {
                        "id": r.get("question_id"), "text": r.get("question_text", ""),
                        "topic": next((q.topic for q in student_questions if q.id == r.get("question_id")), ""),
                        "max_marks": r.get("max_marks"),
                    }
                    service.flag_for_review(q_dict, r, reason="Manually flagged by student/teacher as disagreeing with the AI score.")
                    st.session_state[flag_key] = True
                    st.rerun()

        # -------------------------------------------------
        # 7. Download PDF Report
        # -------------------------------------------------
        st.markdown("---")
        if st.button("📥 Generate PDF Report", type="primary", use_container_width=True):
            student = Student(
                name=student_name.strip() or "Student",
                register_no=register_no.strip() or "REG000",
                department=department.strip() or "General",
                semester=str(semester),
                subject=paper_meta.get("subject", "General"),
            )
            teacher = Teacher(
                name=paper_meta.get("teacher_name", "Teacher"),
                subject=paper_meta.get("subject", "General"),
                max_marks=int(round(overall.get("max_marks", 0))),
            )
            pdf_path = generate_full_report_pdf(student, teacher, student_questions, results, overall)
            st.session_state["eval_pdf_path"] = pdf_path

        pdf_path = st.session_state.get("eval_pdf_path")
        if pdf_path and os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                st.download_button(
                    label="📥 Download Evaluation Report (PDF)",
                    data=f,
                    file_name=os.path.basename(pdf_path),
                    mime="application/pdf",
                    use_container_width=True,
                )

else:

    st.header("🩺 Review Queue — Verify Flagged Evaluations")
    st.caption(
        "Answers land here automatically when the AI score is right at the pass/fail line, "
        "topic relevance was borderline, or AI confidence was low -- plus anything manually "
        "flagged from the results screen. Enter the correct marks once; the system remembers "
        "it as a worked example so future grading of similar answers is anchored by it."
    )

    open_flags = service.list_flags(status="open")
    resolved_flags = service.list_flags(status="resolved")

    st.metric("Open flags awaiting review", len(open_flags))

    if not open_flags:
        st.info("No open flags right now. 🎉")
    else:
        for flag in open_flags:
            title = f"{flag.get('question_text', '')[:70]}{'...' if len(flag.get('question_text', '')) > 70 else ''} — AI gave {flag.get('ai_marks', 0):g}/{flag.get('max_marks', 0):g}"
            with st.expander(title, expanded=False):
                st.markdown(f"**Topic:** {flag.get('topic') or 'General'}")
                st.markdown(f"**Question:** {flag.get('question_text', '')}")
                st.markdown(f"**Student's answer:** {flag.get('student_answer', '') or '_(no answer)_'}")
                st.markdown(f"**AI feedback:** {flag.get('ai_justification', '')}")
                st.markdown(f"**Flag reason:** {flag.get('reason', '')}")

                if flag.get("evidence_map"):
                    st.markdown("**AI's rubric evidence:**")
                    for criterion, evidence in flag["evidence_map"].items():
                        st.caption(f"• {criterion}: {evidence or '_not addressed_'}")

                st.markdown("---")
                st.markdown("**Enter the correct marks**")
                corrected_marks = st.number_input(
                    "Correct marks", min_value=0.0, max_value=float(flag.get("max_marks") or 10.0),
                    value=float(flag.get("ai_marks") or 0.0), step=0.25, key=f"correct_marks_{flag['flag_id']}",
                )
                teacher_reason = st.text_area(
                    "Why (this becomes a worked example for future grading)", key=f"correct_reason_{flag['flag_id']}",
                    placeholder="e.g. Correctly explains the concept in different words -- full credit.",
                )
                if st.button("✅ Confirm marks & resolve", key=f"resolve_{flag['flag_id']}"):
                    service.resolve_flag(flag["flag_id"], teacher_marks=corrected_marks, teacher_reason=teacher_reason)
                    st.success("Resolved and saved as a calibration example.")
                    st.rerun()

    if resolved_flags:
        with st.expander(f"📚 Resolved ({len(resolved_flags)}) -- calibration history", expanded=False):
            for flag in resolved_flags[:20]:
                st.markdown(
                    f"- **{flag.get('question_text', '')[:60]}...** — AI: {flag.get('ai_marks', 0):g}, "
                    f"Teacher: {flag.get('teacher_marks', 0):g}  \n_{flag.get('teacher_reason', '')}_"
                )


st.markdown("---")
st.caption("AI Paper Evaluation System — powered by Streamlit & Ollama (offline, Windows-compatible).")
