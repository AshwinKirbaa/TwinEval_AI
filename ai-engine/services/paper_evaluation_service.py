"""
PaperEvaluationService: orchestrates the full redesigned workflow --
question paper -> AI-generated answer keys -> student answer OCR ->
per-question evaluation -> overall report.

Also owns the calibration/review-loop pieces: loading real teacher-
scored calibration exemplars (dataset/calibration_exemplars.json) to
anchor the grading LLM's judgment, and a persistent flagged-for-review
queue (agents/database) that a teacher can correct -- those corrections
accumulate as the calibration dataset for future tuning (see
tools/calibration_harness.py for the offline metrics report).

This is additive: services/evaluation_service.py (the original,
single-answer-key EvaluationService) is untouched and still works for
any code that depends on it.
"""
import json
import time
import uuid
from collections import Counter
from pathlib import Path
from typing import Callable, Optional

from agents.answer_evaluation_agent import AnswerEvaluationAgent
from agents.answer_key_agent import AnswerKeyAgent
from agents.database import database
from agents.question_agent import QuestionAgent
from agents.student_answer_agent import StudentAnswerAgent
from models.question import AnswerKey, Question

ProgressCallback = Optional[Callable[[int, int, str], None]]

_CALIBRATION_EXEMPLARS_PATH = Path(__file__).parent.parent / "dataset" / "calibration_exemplars.json"


class PaperEvaluationService:

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model
        self.question_agent = QuestionAgent(model=model)
        self.answer_key_agent = AnswerKeyAgent(model=model)
        self.student_answer_agent = StudentAnswerAgent(model=model)
        self.evaluation_agent = AnswerEvaluationAgent(model=model)
        self._calibration_exemplars_cache = None

    # -------------------------------------------------------
    # Teacher side
    # -------------------------------------------------------

    def build_questions_from_text(self, raw_text: str, topic: str = "", default_max_marks: float = 10.0) -> list:
        """Splits raw question-paper text (manual entry or OCR'd upload)
        into a list of Question objects. If a question had its own
        marks annotation in the paper (e.g. "[10 Marks]"), that value is
        used for its max_marks -- the default is only a fallback for
        questions where no per-question marks could be found."""
        split_results = self.question_agent.split_question_paper(raw_text)
        return [
            Question(
                text=item["text"],
                topic=topic,
                max_marks=item["marks"] if item["marks"] is not None else default_max_marks,
                source="upload",
                group_id=item.get("group_id"),
                group_required=item.get("group_required"),
            )
            for item in split_results
        ]

    def generate_answer_keys(self, questions: list, progress_callback: ProgressCallback = None) -> dict:
        """
        questions: list[Question]
        Returns dict[question.id -> AnswerKey.to_dict()]
        """
        answer_keys = {}
        total = len(questions)
        for i, question in enumerate(questions):
            if progress_callback:
                progress_callback(i + 1, total, "generating")
            data = self.answer_key_agent.generate(
                question.text, topic=question.topic, max_marks=question.max_marks
            )
            data["question_id"] = question.id
            answer_keys[question.id] = data
            if progress_callback:
                progress_callback(i + 1, total, "done")
        return answer_keys

    def regenerate_answer_key(self, question) -> dict:
        """Regenerate the answer key for a single question (used by the
        'regenerate' action in the teacher preview UI)."""
        data = self.answer_key_agent.generate(question.text, topic=question.topic, max_marks=question.max_marks)
        data["question_id"] = question.id
        return data

    # -------------------------------------------------------
    # Student side
    # -------------------------------------------------------

    def split_student_answers(self, raw_text: str, questions: list) -> dict:
        """
        Returns dict[question.id -> answer_text], matching answers to
        questions by their 1-based order in the question paper.
        """
        by_index = self.student_answer_agent.split_answers(raw_text, num_questions=len(questions))
        result = {}
        for i, question in enumerate(questions, start=1):
            result[question.id] = by_index.get(i, "")
        return result

    def evaluate_all(self, questions: list, answer_keys: dict, student_answers: dict,
                      progress_callback: ProgressCallback = None, pass_percentage: float = 40.0) -> list:
        """
        Returns a list of per-question result dicts (each augmented
        with the question's id/text/max_marks for display/reporting).

        Also applies "answer any N of M" / "(OR)" alternative selection
        rules (see Question.group_id/group_required and
        apply_group_selection below) so results carry which attempts
        actually count towards the overall total -- matching real exam
        grading, where attempting more than required doesn't inflate
        the score and only one side of an "(OR)" choice counts.
        """
        results = []
        total = len(questions)
        for i, question in enumerate(questions):
            if progress_callback:
                progress_callback(i + 1, total, "evaluating")

            answer_key = answer_keys.get(question.id, AnswerKey(question_id=question.id).to_dict())
            student_answer = student_answers.get(question.id, "")
            exemplars = self.get_calibration_exemplars(subject=question.topic)

            result = self.evaluation_agent.evaluate(
                question=question.to_dict(),
                answer_key=answer_key,
                student_answer=student_answer,
                pass_percentage=pass_percentage,
                calibration_exemplars=exemplars,
            )
            result["question_id"] = question.id
            result["question_text"] = question.text
            result["max_marks"] = question.max_marks
            result["was_attempted"] = bool((student_answer or "").strip())
            results.append(result)

            if progress_callback:
                progress_callback(i + 1, total, "done")

        self.apply_group_selection(questions, results)
        return results

    # -------------------------------------------------------
    # Calibration: load real teacher-scored worked examples used to
    # anchor the grading LLM's judgment (see AnswerEvaluationAgent.
    # _llm_holistic_score's calibration_exemplars param).
    # -------------------------------------------------------

    def get_calibration_exemplars(self, subject: str = "") -> list:
        """
        Loads dataset/calibration_exemplars.json (a flat list of
        {"subject", "question", "answer", "marks", "max_marks",
        "justification"} entries, populated over time from teacher
        corrections -- see resolve_flag() below). Returns exemplars
        matching `subject` (case-insensitive) if any exist, otherwise
        falls back to any subject-agnostic ones. Empty list (not an
        error) if the file doesn't exist yet or nothing matches --
        the grading prompt simply runs without exemplars in that case.
        """
        if self._calibration_exemplars_cache is None:
            try:
                with open(_CALIBRATION_EXEMPLARS_PATH, "r", encoding="utf-8") as f:
                    self._calibration_exemplars_cache = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                self._calibration_exemplars_cache = []

        all_exemplars = self._calibration_exemplars_cache
        if not all_exemplars:
            return []

        subject_norm = (subject or "").strip().lower()
        if subject_norm:
            matching = [e for e in all_exemplars if (e.get("subject") or "").strip().lower() == subject_norm]
            if matching:
                return matching
        return [e for e in all_exemplars if not (e.get("subject") or "").strip()]

    # -------------------------------------------------------
    # Human-in-the-loop review queue (flag -> teacher correction ->
    # calibration dataset). This is the feedback loop: every corrected
    # flag is appended to dataset/calibration_exemplars.json so future
    # grading runs are anchored by real, teacher-verified examples.
    # -------------------------------------------------------

    @staticmethod
    def flag_for_review(question: dict, result: dict, reason: str, flagged_by: str = "") -> str:
        """Saves a question/result pair to the persistent review queue.
        Returns the flag id."""
        flag_id = uuid.uuid4().hex[:12]
        database.save(f"flag:{flag_id}", {
            "flag_id": flag_id,
            "question_id": question.get("id"),
            "question_text": question.get("text", ""),
            "topic": question.get("topic", ""),
            "max_marks": question.get("max_marks"),
            "student_answer": result.get("student_answer", ""),
            "ai_marks": result.get("marks"),
            "ai_justification": result.get("feedback", ""),
            "evidence_map": result.get("evidence_map", {}),
            "reason": reason,
            "flagged_by": flagged_by,
            "status": "open",
            "created_at": time.time(),
        })
        return flag_id

    @staticmethod
    def list_flags(status: str = "open") -> list:
        flags = [database.load(k) for k in database.list_keys("flag:")]
        flags = [f for f in flags if f]
        if status:
            flags = [f for f in flags if f.get("status") == status]
        flags.sort(key=lambda f: f.get("created_at", 0), reverse=True)
        return flags

    def resolve_flag(self, flag_id: str, teacher_marks: float, teacher_reason: str) -> None:
        """
        Records the teacher's corrected marks for a flagged answer,
        marks the flag resolved, AND appends the correction to the
        calibration exemplar dataset -- this is what closes the
        feedback loop: the next time a similar answer is graded, this
        real, human-verified example is shown to the LLM as a worked
        example (see get_calibration_exemplars above).
        """
        flag = database.load(f"flag:{flag_id}")
        if not flag:
            return
        flag["status"] = "resolved"
        flag["teacher_marks"] = teacher_marks
        flag["teacher_reason"] = teacher_reason
        flag["resolved_at"] = time.time()
        database.save(f"flag:{flag_id}", flag)

        exemplar = {
            "subject": flag.get("topic", ""),
            "question": flag.get("question_text", ""),
            "answer": flag.get("student_answer", ""),
            "marks": teacher_marks,
            "max_marks": flag.get("max_marks"),
            "justification": teacher_reason or "Teacher-corrected grading.",
        }
        try:
            existing = []
            if _CALIBRATION_EXEMPLARS_PATH.exists():
                with open(_CALIBRATION_EXEMPLARS_PATH, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            existing.append(exemplar)
            _CALIBRATION_EXEMPLARS_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(_CALIBRATION_EXEMPLARS_PATH, "w", encoding="utf-8") as f:
                json.dump(existing, f, indent=2, ensure_ascii=False)
            self._calibration_exemplars_cache = None  # force reload next time
        except OSError as e:
            print(f"Could not persist calibration exemplar: {e}")

    @staticmethod
    def apply_group_selection(questions: list, results: list) -> list:
        """
        Applies "answer any N of M questions" / "(OR)" alternative
        selection across grouped questions (Question.group_id /
        group_required) so the overall total only ever counts the
        required number of best-scoring attempts per group.

        Mutates and returns `results` in place, adding to each result:
          - "counted": bool -- whether this question's marks count
            towards the overall total.
          - "group_note": str -- human-readable reason.
          - "contributed_marks" / "contributed_max_marks": the marks
            and max marks this question actually contributes to the
            overall total (0 for a not-counted extra attempt or an
            unanswered non-required alternative).
        Ungrouped questions (group_id is None) always count in full.
        """
        q_by_id = {q.id: q for q in questions}
        groups = {}
        for r in results:
            q = q_by_id.get(r.get("question_id"))
            gid = q.group_id if q else None
            if gid is None:
                r["counted"] = True
                r["group_note"] = ""
                r["contributed_marks"] = r.get("marks", 0.0)
                r["contributed_max_marks"] = r.get("max_marks", 0.0)
                continue
            groups.setdefault(gid, []).append((q, r))

        for gid, members in groups.items():
            required = members[0][0].group_required or 1

            # Denominator: the `required` highest-value questions in the
            # group define the section's maximum achievable marks,
            # regardless of which ones were actually attempted -- the
            # ceiling doesn't shrink just because a student skipped one
            # of the alternatives.
            by_max = sorted(members, key=lambda pair: pair[1].get("max_marks", 0.0), reverse=True)
            counted_max_ids = {id(pair[1]) for pair in by_max[:required]}

            # Numerator: of the ones actually attempted, only the best
            # `required` count -- extra attempts beyond what's needed
            # don't add to the total (matches how the sample script was
            # graded: an unrequired extra attempt was marked 0/ignored).
            attempted = [(q, r) for q, r in members if r.get("was_attempted")]
            attempted.sort(key=lambda pair: pair[1].get("marks", 0.0), reverse=True)
            counted_marks_ids = {id(pair[1]) for pair in attempted[:required]}

            for q, r in members:
                r["counted"] = id(r) in counted_marks_ids
                if not r.get("was_attempted"):
                    r["group_note"] = f"Not attempted (only {required} of {len(members)} needed in this choice group)."
                elif r["counted"]:
                    r["group_note"] = f"Counted towards this {required}-of-{len(members)} choice group."
                else:
                    r["group_note"] = (
                        f"Extra attempt beyond the required {required} in this choice group -- "
                        "not counted towards the total."
                    )
                r["contributed_marks"] = r.get("marks", 0.0) if r["counted"] else 0.0
                r["contributed_max_marks"] = r.get("max_marks", 0.0) if id(r) in counted_max_ids else 0.0

        return results

    # -------------------------------------------------------
    # Overall report
    # -------------------------------------------------------

    def build_overall_report(self, results: list, pass_percentage: float = 40.0) -> dict:
        if not results:
            return {
                "total_marks": 0.0,
                "max_marks": 0.0,
                "percentage": 0.0,
                "grade": "F",
                "pass_fail": "Fail",
                "overall_strengths": [],
                "overall_weaknesses": [],
                "frequently_missed_concepts": [],
                "topics_to_revise": [],
                "areas_to_improve": [],
                "recommendations": [],
                "study_suggestions": [],
            }

        total_marks = sum(r.get("contributed_marks", r.get("marks", 0.0)) for r in results)
        max_marks = sum(r.get("contributed_max_marks", r.get("max_marks", 0.0)) for r in results)
        percentage = round((total_marks / max_marks) * 100.0, 1) if max_marks else 0.0
        grade = self._grade_for(percentage)
        pass_fail = "Pass" if percentage >= pass_percentage else "Fail"

        # Aggregate strengths/weaknesses/missing concepts across all
        # counted questions only -- feedback shouldn't be driven by an
        # extra attempt that isn't part of the final score.
        all_strengths = []
        all_weaknesses = []
        missing_concept_counter = Counter()
        low_score_topics = []

        for r in results:
            if not r.get("counted", True):
                continue
            all_strengths.extend(r.get("strengths", []))
            all_weaknesses.extend(r.get("improvements", []))
            for concept in r.get("missing_concepts", []):
                missing_concept_counter[concept] += 1
            if r.get("percentage", 0) < 50 and r.get("question_text"):
                low_score_topics.append(r["question_text"][:80])

        frequently_missed = [c for c, _ in missing_concept_counter.most_common(8)]

        recommendations = []
        if frequently_missed:
            recommendations.append(
                f"Revise these frequently missed concepts: {', '.join(frequently_missed[:5])}."
            )
        if low_score_topics:
            recommendations.append(
                "Focus additional study time on the lowest-scoring questions/topics."
            )
        if percentage < pass_percentage:
            recommendations.append(
                "Overall performance is below the passing threshold -- a structured revision plan is recommended before the next assessment."
            )
        if not recommendations:
            recommendations.append("Strong overall performance -- continue reinforcing depth and precision in answers.")

        study_suggestions = [
            f"Review and practice questions related to: {c}" for c in frequently_missed[:5]
        ] or ["Continue practicing past papers to maintain strong performance."]

        return {
            "total_marks": round(total_marks, 2),
            "max_marks": round(max_marks, 2),
            "percentage": percentage,
            "grade": grade,
            "pass_fail": pass_fail,
            "overall_strengths": self._top_unique(all_strengths, 6),
            "overall_weaknesses": self._top_unique(all_weaknesses, 6),
            "frequently_missed_concepts": frequently_missed,
            "topics_to_revise": low_score_topics[:6],
            "areas_to_improve": self._top_unique(all_weaknesses, 6),
            "recommendations": recommendations,
            "study_suggestions": study_suggestions,
        }

    @staticmethod
    def _top_unique(items: list, n: int) -> list:
        seen = []
        for item in items:
            if item not in seen:
                seen.append(item)
            if len(seen) >= n:
                break
        return seen

    @staticmethod
    def _grade_for(percentage: float) -> str:
        if percentage >= 90:
            return "A+"
        elif percentage >= 80:
            return "A"
        elif percentage >= 70:
            return "B+"
        elif percentage >= 60:
            return "B"
        elif percentage >= 50:
            return "C"
        elif percentage >= 40:
            return "D"
        return "F"
