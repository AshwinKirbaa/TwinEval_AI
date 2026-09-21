"""
AnswerEvaluationAgent: evaluates a single student answer against an
AI-generated AnswerKey (see agents/answer_key_agent.py), producing the
full per-question result the redesigned UI needs.

This is a NEW agent -- it does not modify or replace
agents/ollama_vision_agent.py's OllamaVisionAgent.evaluate(), which
remains available unchanged for backward compatibility with the
original single-answer-key workflow.

Reuses the existing ConceptAgent / BloomAgent / FeedbackAgent building
blocks so behavior stays consistent with the rest of the app.
"""
import json
import math
import re

from utils import ollama_client

from agents.bloom_agent import BloomAgent
from agents.concept_agent import ConceptAgent
from agents.feedback_agent import FeedbackAgent
from agents.topic_agent import TopicRelevanceAgent


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


class AnswerEvaluationAgent:

    # Below this relevance score, the answer is treated as off-topic
    # and awarded (near) zero marks regardless of textual quality.
    OFF_TOPIC_THRESHOLD = 0.15

    # Questions worth this many marks or fewer are treated as short,
    # objective items (MCQ / True-False / fill-in-the-blank / one-word).
    # These don't get the full concept/keyword/rubric pipeline -- there's
    # nothing to "partially explain" in a 0.5 or 1 mark answer, so it's
    # graded the way a human would: is the stated answer/option the same
    # as the correct one, or not. Full marks or zero, nothing in between.
    OBJECTIVE_MARKS_THRESHOLD = 1.0

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model
        self.concept_agent = ConceptAgent()
        self.bloom_agent = BloomAgent()
        self.feedback_agent = FeedbackAgent()
        self.topic_agent = TopicRelevanceAgent(model=model)

    # Auto-flag any result within this many percentage points of the
    # pass/fail line for mandatory human review -- this is exactly
    # where a wrong automated call matters most.
    BORDERLINE_PASS_BAND = 5.0
    # Auto-flag low-confidence AI judgments too.
    LOW_CONFIDENCE_THRESHOLD = 55.0

    def evaluate(self, question: dict, answer_key: dict, student_answer: str,
                 pass_percentage: float = 40.0, calibration_exemplars: list = None) -> dict:
        """
        question: Question.to_dict()  (needs "text", "max_marks")
        answer_key: AnswerKey.to_dict()
        student_answer: extracted OCR/typed text for this question
        pass_percentage: used only to auto-flag borderline pass/fail
            results for human review (see _needs_review below) -- does
            not affect scoring.
        calibration_exemplars: optional list of {"question", "answer",
            "marks", "max_marks", "justification"} dicts -- real,
            teacher-scored example answers (ideally for this subject/
            topic) injected into the holistic grading prompt as worked
            examples, the single highest-leverage way to correct a
            systematic too-strict/too-lenient bias without retraining.
        """
        max_marks = float(question.get("max_marks", 10.0)) or 10.0
        question_text = question.get("text", "")
        student_answer = (student_answer or "").strip()

        # ---------------------------------------------------
        # 0. No answer at all
        # ---------------------------------------------------
        if not student_answer:
            return self._empty_answer_result(answer_key, max_marks)

        # ---------------------------------------------------
        # 0.5. Objective / short-answer fast path (0.5-1 mark items):
        #      skip topic-relevance LLM call, concept/keyword semantic
        #      matching, and rubric scoring entirely -- just check
        #      whether the stated answer/option matches the correct one.
        # ---------------------------------------------------
        if max_marks <= self.OBJECTIVE_MARKS_THRESHOLD:
            return self._evaluate_objective(answer_key, student_answer, max_marks)

        # ---------------------------------------------------
        # 1. Topic-relevance gate -- never award marks for a
        #    well-written answer to the wrong question/topic.
        # ---------------------------------------------------
        relevance = self.topic_agent.check(question_text, student_answer)
        if not relevance["is_relevant"] or relevance["relevance_score"] < self.OFF_TOPIC_THRESHOLD:
            return self._off_topic_result(answer_key, max_marks, relevance)

        # ---------------------------------------------------
        # 2. Concept / keyword coverage
        # ---------------------------------------------------
        model_answer = answer_key.get("model_answer", "")
        concepts_expected = answer_key.get("concepts") or []
        keywords_expected = answer_key.get("keywords") or []

        found_concepts, missing_concepts = self.concept_agent.check_concepts(
            question.get("topic") or "General Evaluation",
            student_answer,
            teacher_answer=model_answer or "\n".join(concepts_expected),
        )
        # If the answer key explicitly listed concepts, prefer that
        # authoritative list over whatever heuristic extraction found.
        if concepts_expected:
            found_concepts, missing_concepts = self._match_terms(concepts_expected, student_answer)

        found_keywords, missing_keywords = self._match_terms(keywords_expected, student_answer)

        # ---------------------------------------------------
        # 3. Structural coverage: points / advantages / disadvantages /
        #    applications / formulae / algorithm steps / diagrams
        # ---------------------------------------------------
        found_points, missing_points = self._match_terms(answer_key.get("expected_points") or [], student_answer)
        found_advantages, missing_advantages = self._match_terms(answer_key.get("advantages") or [], student_answer)
        found_disadvantages, missing_disadvantages = self._match_terms(answer_key.get("disadvantages") or [], student_answer)
        found_applications, missing_applications = self._match_terms(answer_key.get("applications") or [], student_answer)
        found_formulae, missing_formulae = self._match_terms(answer_key.get("formulae") or [], student_answer)
        found_steps, missing_steps = self._match_terms(answer_key.get("steps") or [], student_answer)
        found_diagrams, missing_diagrams = self._match_diagrams(answer_key.get("diagrams") or [], student_answer)

        # ---------------------------------------------------
        # 4. Marks: holistic LLM judgment first (does this answer show
        #    real, relevant understanding of the question -- regardless
        #    of exact keyword/phrasing match?), falling back to the
        #    mechanical concept/keyword-coverage rubric scoring only if
        #    the LLM call itself fails (keeps grading offline-safe).
        # ---------------------------------------------------
        rubric = answer_key.get("rubric") or {"concept_coverage": max_marks}
        holistic = self._llm_holistic_score(
            question_text, model_answer, rubric, student_answer, max_marks,
            calibration_exemplars=calibration_exemplars,
        )

        evidence_map = {}
        if holistic is not None:
            marks_breakdown, total_marks, justification, evidence_map = holistic
        else:
            justification = ""
            marks_breakdown, total_marks = self._score_rubric(
                rubric=rubric,
                found_concepts=found_concepts,
                missing_concepts=missing_concepts,
                found_keywords=found_keywords,
                missing_keywords=missing_keywords,
                found_points=found_points,
                missing_points=missing_points,
                found_advantages=found_advantages,
                missing_advantages=missing_advantages,
                found_disadvantages=found_disadvantages,
                missing_disadvantages=missing_disadvantages,
                found_applications=found_applications,
                missing_applications=missing_applications,
                found_formulae=found_formulae,
                missing_formulae=missing_formulae,
                found_steps=found_steps,
                missing_steps=missing_steps,
                found_diagrams=found_diagrams,
                missing_diagrams=missing_diagrams,
                student_answer=student_answer,
                model_answer=model_answer,
                relevance_score=relevance["relevance_score"],
            )

        percentage = round((total_marks / max_marks) * 100.0, 1) if max_marks else 0.0
        grade = _grade_for(percentage)

        # ---------------------------------------------------
        # 5. Bloom level + narrative feedback
        # ---------------------------------------------------
        bloom_result = self.bloom_agent.analyze(student_answer)
        feedback_result = self.feedback_agent.generate_feedback(
            {"Concepts": marks_breakdown.get("concept_coverage", 0), "Completeness": marks_breakdown.get("completeness", 0),
             "Structure": 1.0 if len(student_answer) > 40 else 0.0},
            bloom_result,
            found_concepts=found_concepts,
            missing_concepts=missing_concepts,
        )

        strengths = list(feedback_result.get("strengths", []))
        improvements = list(feedback_result.get("improvements", []))
        if missing_keywords:
            improvements.append(f"Missing expected keyword(s): {', '.join(missing_keywords[:5])}.")
        if missing_diagrams:
            improvements.append(f"Missing/incomplete diagram(s): {', '.join(missing_diagrams[:3])}.")

        confidence = round(min(100.0, 60.0 + relevance["relevance_score"] * 40.0), 1)
        needs_review, review_reason = self._needs_review(percentage, relevance, confidence, pass_percentage)

        return {
            "student_answer": student_answer,
            "is_off_topic": False,
            "marks": round(total_marks, 2),
            "max_marks": max_marks,
            "percentage": percentage,
            "grade": grade,
            "marks_breakdown": marks_breakdown,
            "evidence_map": evidence_map,
            "found_concepts": found_concepts,
            "missing_concepts": missing_concepts,
            "found_keywords": found_keywords,
            "missing_keywords": missing_keywords,
            "missing_points": missing_points,
            "missing_diagrams": missing_diagrams,
            "strengths": strengths,
            "improvements": improvements,
            "suggestions": feedback_result.get("suggestions", []),
            "confidence": confidence,
            "bloom_level": bloom_result.get("level", "Understand"),
            "topic_relevance": relevance,
            "feedback": self._compose_feedback(percentage, relevance, missing_concepts, missing_keywords, justification),
            "needs_review": needs_review,
            "review_reason": review_reason,
        }

    @classmethod
    def _needs_review(cls, percentage: float, relevance: dict, confidence: float, pass_percentage: float) -> tuple:
        """
        Auto-flags results that fall into exactly the situations where
        an automated score is least trustworthy and a wrong call
        matters most: right at the pass/fail boundary, borderline
        topic-relevance, or low model confidence. Returns
        (needs_review: bool, reason: str).
        """
        reasons = []
        if abs(percentage - pass_percentage) <= cls.BORDERLINE_PASS_BAND:
            reasons.append(f"Score ({percentage}%) is within {cls.BORDERLINE_PASS_BAND} points of the pass/fail line ({pass_percentage}%).")
        if 0.3 <= relevance.get("relevance_score", 1.0) <= 0.55:
            reasons.append("Topic relevance was borderline.")
        if confidence < cls.LOW_CONFIDENCE_THRESHOLD:
            reasons.append(f"AI confidence was low ({confidence}%).")
        return (bool(reasons), " ".join(reasons))

    # -------------------------------------------------------
    # Holistic LLM-judgment scoring (meaning/relevance over exact wording)
    # -------------------------------------------------------

    def _llm_holistic_score(self, question_text: str, model_answer: str, rubric: dict, student_answer: str,
                             max_marks: float, calibration_exemplars: list = None):
        """
        Asks the LLM to grade the student's answer the way a fair human
        examiner would: reward a genuinely relevant, correct explanation
        of the concept even if it uses different words/examples/keywords
        than the reference answer, and only deduct for content that is
        actually missing, wrong, or irrelevant -- not for wording.

        Requires the model to point to the actual evidence in the
        student's answer for each criterion BEFORE giving marks (a
        rubric-aware, transparent evaluation: every mark is traceable
        to a specific piece of the answer, not just a bare number).

        calibration_exemplars: optional list of real, teacher-scored
        example answers (each a dict with "question", "answer",
        "marks", "max_marks", "justification") shown to the model as
        worked examples of correct grading calibration. This is the
        cheapest, highest-leverage way to correct a systematic too-
        strict/too-lenient bias -- concrete graded examples anchor the
        model's judgment far more reliably than instructions alone.

        Returns (marks_breakdown: dict, total_marks: float,
        justification: str, evidence_map: dict[criterion -> evidence
        text]), or None if the call fails or the response can't be
        parsed (the caller falls back to mechanical concept/keyword-
        ratio scoring).
        """
        if not rubric:
            return None

        criteria_desc = "; ".join(f'"{c}" (max {m} marks)' for c, m in rubric.items())

        exemplar_block = ""
        if calibration_exemplars:
            examples_text = []
            for ex in calibration_exemplars[:3]:  # keep the prompt short; 2-3 is enough to anchor calibration
                examples_text.append(
                    f'- Question: "{ex.get("question", "")}"\n'
                    f'  Student answer: "{ex.get("answer", "")}"\n'
                    f'  Correct grading: {ex.get("marks")}/{ex.get("max_marks")} -- {ex.get("justification", "")}'
                )
            exemplar_block = (
                "\nHere are real examples of how a human examiner graded similar answers -- "
                "match this level of strictness/leniency:\n" + "\n".join(examples_text) + "\n"
            )

        prompt = f"""You are an experienced, fair university examiner grading a student's handwritten exam answer.
{exemplar_block}
Question:
\"\"\"{question_text}\"\"\"

Reference/model answer (use this ONLY to understand what a complete answer would cover -- the student does NOT need to match its exact wording, structure, or keywords):
\"\"\"{model_answer}\"\"\"

Student's actual answer:
\"\"\"{student_answer}\"\"\"

Grade this answer out of {max_marks} total marks, split across these rubric criteria: {criteria_desc}.

Grading philosophy (follow this strictly):
- Judge whether the answer is MEANINGFUL, RELEVANT, and demonstrates genuine understanding of what the question is asking -- not whether it repeats the reference answer's exact keywords or phrasing.
- If the student explains the correct idea in their own words, with different terminology, ordering, or examples, give full or near-full credit for that idea -- reward understanding, not vocabulary matching.
- Only deduct marks for content that is genuinely missing, factually incorrect, or irrelevant to the question -- never purely for using different words to say the same correct thing.
- Give partial credit generously and realistically, proportional to how much of the expected understanding the answer actually shows.
- A short but conceptually complete and correct answer can still earn full marks; a long answer that pads length without real content should not.
- Before assigning marks for EACH criterion, first identify the specific part of the student's answer (quote or closely paraphrase it) that addresses that criterion. If nothing in the answer addresses a criterion, say so explicitly rather than inventing evidence.

Return ONLY valid JSON, no markdown fences, no commentary, in exactly this format:
{{
  "evidence": {{"<criterion name>": "the specific evidence from the student's answer for this criterion, or 'not addressed' if nothing covers it", ...}},
  "marks": {{"<criterion name exactly as given above>": <marks earned, a number>, ...}},
  "justification": "one or two sentence overall explanation of the grading"
}}

The criterion names in your JSON must exactly match: {list(rubric.keys())}. Each criterion's marks must be a number between 0 and its stated max.
"""
        try:
            response = ollama_client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0.2, "top_p": 0.5},
            )
            content = response["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.MULTILINE).strip()
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                content = match.group(0)
            parsed = json.loads(content)

            marks_raw = parsed.get("marks", {})
            if not isinstance(marks_raw, dict):
                return None
            evidence_raw = parsed.get("evidence", {})
            if not isinstance(evidence_raw, dict):
                evidence_raw = {}

            breakdown = {}
            evidence_map = {}
            total = 0.0
            for criterion, max_for_criterion in rubric.items():
                try:
                    val = float(marks_raw.get(criterion, 0))
                except (TypeError, ValueError):
                    val = 0.0
                val = max(0.0, min(float(max_for_criterion), val))
                breakdown[criterion] = round(val, 2)
                total += val
                evidence_map[criterion] = str(evidence_raw.get(criterion, "")).strip()

            justification = str(parsed.get("justification", "")).strip()
            return breakdown, round(total, 2), justification, evidence_map
        except Exception as e:
            print(f"LLM holistic scoring failed, falling back to rubric-ratio scoring: {e}")
            return None

    # -------------------------------------------------------
    # Rubric scoring
    # -------------------------------------------------------

    def _score_rubric(self, rubric, found_concepts, missing_concepts, found_keywords, missing_keywords,
                       found_points, missing_points, found_advantages, missing_advantages,
                       found_disadvantages, missing_disadvantages, found_applications, missing_applications,
                       found_formulae, missing_formulae, found_steps, missing_steps,
                       found_diagrams, missing_diagrams,
                       student_answer, model_answer, relevance_score) -> tuple:
        """
        Distributes each rubric criterion's max marks based on coverage
        ratio for that criterion. Returns (breakdown dict, total marks).
        """
        def ratio(found_n, missing_n):
            """Coverage ratio for a criterion, curved with sqrt() so
            partial coverage earns real partial credit instead of being
            scored down linearly. A student who covers 1 of 3 expected
            points understood *something* correctly and explained it --
            linear scoring (0.33) punishes that far more than a human
            examiner would; sqrt(0.33) = 0.58 is a much closer match to
            how the sample marked script grades genuine partial answers.
            An answer that covers nothing for a criterion still scores 0.
            """
            total = found_n + missing_n
            if total == 0:
                return 1.0  # nothing was expected for this criterion -> full credit
            if found_n == 0:
                return 0.0
            return round(math.sqrt(found_n / total), 3)

        concept_ratio = ratio(len(found_concepts), len(missing_concepts))
        keyword_ratio = ratio(len(found_keywords), len(missing_keywords))
        points_ratio = ratio(len(found_points), len(missing_points))
        adv_ratio = ratio(len(found_advantages), len(missing_advantages))
        disadv_ratio = ratio(len(found_disadvantages), len(missing_disadvantages))
        app_ratio = ratio(len(found_applications), len(missing_applications))
        formula_ratio = ratio(len(found_formulae), len(missing_formulae))
        steps_ratio = ratio(len(found_steps), len(missing_steps))
        diagram_ratio = ratio(len(found_diagrams), len(missing_diagrams))

        # Length is a weak, secondary signal only -- a concise but
        # correct handwritten answer should never be capped just for
        # being shorter than an elaborate AI-generated model answer.
        # Full credit is given well before matching the model answer's
        # length, and it only nudges the score, never gates it (see the
        # weighted average below, not a min()).
        length_ratio = 1.0
        if model_answer:
            model_len = max(1, len(model_answer.split()))
            length_ratio = min(1.0, len(student_answer.split()) / (model_len * 0.35))

        # Weighted average, not min(): a slightly short but concept-
        # complete answer should not be dragged down to its weakest
        # sub-score. Concept/point coverage matters far more than length.
        completeness_ratio = round(
            (concept_ratio * 0.45) + (points_ratio * 0.45) + (length_ratio * 0.10), 3
        )

        criterion_ratios = {
            "concept_coverage": concept_ratio,
            "keywords": keyword_ratio,
            "technical_correctness": (concept_ratio + keyword_ratio) / 2,
            "completeness": completeness_ratio,
            "logical_flow": 1.0 if len(re.findall(r"[.!?]", student_answer)) >= 2 else 0.6,
            "advantages_disadvantages": (adv_ratio + disadv_ratio) / 2,
            "advantages": adv_ratio,
            "disadvantages": disadv_ratio,
            "applications": app_ratio,
            "formulae_or_algorithm": (formula_ratio + steps_ratio) / 2,
            "formulae": formula_ratio,
            "algorithms": steps_ratio,
            "steps": steps_ratio,
            "diagram": diagram_ratio,
            "topic_relevance": relevance_score,
        }

        breakdown = {}
        total = 0.0
        for criterion, max_for_criterion in rubric.items():
            r = criterion_ratios.get(criterion, concept_ratio)
            earned = round(float(max_for_criterion) * r, 2)
            breakdown[criterion] = earned
            total += earned

        return breakdown, total

    # -------------------------------------------------------
    # Objective / short-answer fast path
    # -------------------------------------------------------

    @staticmethod
    def _normalize_short_answer(text: str) -> str:
        """Lowercases, strips a leading option-letter marker like 'b)'
        or '(b)' down to just the letter, drops punctuation, collapses
        whitespace. Used only for the objective 0.5-1 mark fast path."""
        t = text.lower().strip()
        t = re.sub(r"^[\(\[]?\s*([a-d])\s*[\)\].:]\s*", r"\1 ", t)
        t = re.sub(r"[^a-z0-9\s]", " ", t)
        t = re.sub(r"\s+", " ", t).strip()
        return t

    def _evaluate_objective(self, answer_key: dict, student_answer: str, max_marks: float) -> dict:
        """
        Direct answer-match grading for short, objective questions
        (MCQ, True/False, fill-in-the-blank, one-word answers). No
        partial credit -- the stated answer either matches the correct
        one (full marks) or it doesn't (zero), the way a human marks a
        0.5/1 mark objective item. Matches on: exact text, the option
        letter (a/b/c/d), True/False synonyms (T/F), or -- for a short
        phrase answer -- most of its significant words being present.
        """
        correct_raw = (answer_key.get("model_answer") or "").strip()
        keywords = [k for k in (answer_key.get("keywords") or []) if str(k).strip()]
        candidates = [c for c in [correct_raw] + keywords if c]

        student_norm = self._normalize_short_answer(student_answer)
        student_letter_m = re.match(r"^([a-d])\b", student_norm)
        student_letter = student_letter_m.group(1) if student_letter_m else None
        tf_map = {"t": "true", "f": "false"}
        student_tf = tf_map.get(student_norm, student_norm)

        is_correct = False
        for cand in candidates:
            cand_norm = self._normalize_short_answer(str(cand))
            if not cand_norm:
                continue

            if cand_norm == student_norm:
                is_correct = True
                break

            # For short phrase answers, require strong token/stem overlap
            # instead of substring matching.  Substring matching wrongly
            # marks answers like "not backpropagation" as correct when the
            # key is simply "backpropagation".
            cand_stems = {self._stem(w) for w in re.findall(r"[a-z0-9]{3,}", cand_norm)}
            student_stems = {self._stem(w) for w in re.findall(r"[a-z0-9]{3,}", student_norm)}
            if cand_stems and student_stems:
                overlap = len(cand_stems & student_stems) / len(cand_stems)
                if overlap >= 0.8 and len(student_stems) <= len(cand_stems) + 2:
                    is_correct = True
                    break

            cand_letter_m = re.match(r"^([a-d])\b", cand_norm)
            if student_letter and cand_letter_m and student_letter == cand_letter_m.group(1):
                is_correct = True
                break

            cand_tf = tf_map.get(cand_norm, cand_norm)
            if cand_tf in ("true", "false") and student_tf == cand_tf:
                is_correct = True
                break


        marks = round(max_marks, 2) if is_correct else 0.0
        percentage = 100.0 if is_correct else 0.0
        grade = _grade_for(percentage)
        correct_display = correct_raw or (", ".join(keywords) if keywords else "")

        return {
            "student_answer": student_answer,
            "is_off_topic": False,
            "marks": marks,
            "max_marks": max_marks,
            "percentage": percentage,
            "grade": grade,
            "marks_breakdown": {"correct_answer": marks},
            "found_concepts": [correct_raw] if is_correct and correct_raw else [],
            "missing_concepts": [] if is_correct else ([correct_raw] if correct_raw else []),
            "found_keywords": keywords if is_correct else [],
            "missing_keywords": [] if is_correct else keywords,
            "missing_points": [],
            "missing_diagrams": [],
            "strengths": ["Correct answer."] if is_correct else [],
            "improvements": [] if is_correct else (
                [f"Correct answer: {correct_display}."] if correct_display else ["Answer did not match the expected option."]
            ),
            "suggestions": [],
            "confidence": 95.0,
            "bloom_level": answer_key.get("bloom_level", "Remember"),
            "topic_relevance": {
                "is_relevant": True,
                "relevance_score": 1.0 if is_correct else 0.0,
                "reason": "Objective question -- graded by direct answer match, not topic relevance.",
            },
            "feedback": "Correct." if is_correct else f"Incorrect.{(' Correct answer: ' + correct_display + '.') if correct_display else ''}",
            "evidence_map": {},
            "needs_review": False,
            "review_reason": "",
        }

    # -------------------------------------------------------
    # Off-topic / empty-answer short circuits
    # -------------------------------------------------------

    def _off_topic_result(self, answer_key: dict, max_marks: float, relevance: dict) -> dict:
        # A clearly off-topic answer earns zero.  Do not award a token
        # fraction based only on the relevance classifier; that produces
        # arbitrary marks for answers that do not address the question.
        marks = 0.0
        return {
            "student_answer": "",
            "is_off_topic": True,
            "marks": marks,
            "max_marks": max_marks,
            "percentage": round((marks / max_marks) * 100.0, 1) if max_marks else 0.0,
            "grade": _grade_for((marks / max_marks) * 100.0 if max_marks else 0.0),
            "marks_breakdown": {},
            "found_concepts": [],
            "missing_concepts": answer_key.get("concepts", []),
            "found_keywords": [],
            "missing_keywords": answer_key.get("keywords", []),
            "missing_points": answer_key.get("expected_points", []),
            "missing_diagrams": answer_key.get("diagrams", []),
            "strengths": [],
            "improvements": ["Answer does not address the question that was asked."],
            "suggestions": ["Re-read the question carefully and answer the specific topic asked."],
            "confidence": round(90.0 - relevance["relevance_score"] * 20, 1),
            "bloom_level": "Remember",
            "topic_relevance": relevance,
            "feedback": f"This answer appears to be off-topic. {relevance.get('reason', '')}".strip(),
            "evidence_map": {},
            # Off-topic/zero-mark calls are exactly the kind of decision
            # worth a human sanity-check before it's final.
            "needs_review": True,
            "review_reason": "Flagged off-topic by AI -- verify before finalizing zero/near-zero marks.",
        }

    def _empty_answer_result(self, answer_key: dict, max_marks: float) -> dict:
        return {
            "student_answer": "",
            "is_off_topic": False,
            "marks": 0.0,
            "max_marks": max_marks,
            "percentage": 0.0,
            "grade": "F",
            "marks_breakdown": {},
            "found_concepts": [],
            "missing_concepts": answer_key.get("concepts", []),
            "found_keywords": [],
            "missing_keywords": answer_key.get("keywords", []),
            "missing_points": answer_key.get("expected_points", []),
            "missing_diagrams": answer_key.get("diagrams", []),
            "strengths": [],
            "improvements": ["No answer was provided for this question."],
            "suggestions": ["Attempt every question, even partially, for part marks."],
            "confidence": 100.0,
            "bloom_level": "Remember",
            "topic_relevance": {"is_relevant": False, "relevance_score": 0.0, "reason": "No answer provided."},
            "feedback": "No answer was provided for this question.",
            "evidence_map": {},
            "needs_review": False,
            "review_reason": "",
        }

    # -------------------------------------------------------
    # Term / diagram matching helpers
    # -------------------------------------------------------

    @staticmethod
    def _stem(word: str) -> str:
        """Very light suffix-stripping so 'encoders'/'encoder',
        'regularization'/'regularize', 'generating'/'generated'/'generate'
        etc. are recognised as the same term. Not a real stemmer, just
        enough to stop exact-string matching from missing an answer that
        used a different grammatical form of the same word."""
        w = word.lower()
        for suffix in ("ations", "ation", "ational", "ing", "ized", "izes", "ize",
                       "ised", "ises", "ise", "edly", "ies", "ied", "es", "ed", "er",
                       "ers", "or", "ors", "s"):
            if w.endswith(suffix) and len(w) - len(suffix) >= 4:
                return w[: -len(suffix)]
        return w

    @staticmethod
    def _match_terms(terms: list, student_answer: str) -> tuple:
        """Case-insensitive, stem-aware matching of expected terms/points
        against the student answer, keyed on their significant words.

        This is intentionally lenient: the goal is to reward a student who
        clearly *references and explains* a concept in their own words, not
        to demand the exact phrasing of an ideal/AI-generated answer key.
        A handwritten answer that covers the core idea with roughly half
        the significant words of an expected term/point is treated as
        covered -- the full-mark judgement of "how well" it's explained is
        left to the rubric ratios and Bloom/feedback layer, not this gate.
        Returns (found, missing)."""
        answer_lower = student_answer.lower()
        answer_stems = {
            AnswerEvaluationAgent._stem(w)
            for w in re.findall(r"[A-Za-z]{3,}", answer_lower)
        }
        found, missing = [], []
        for term in terms:
            term_clean = str(term).strip()
            if not term_clean:
                continue
            key_terms = re.findall(r"[A-Za-z]{3,}", term_clean.lower())
            if not key_terms:
                continue
            key_stems = [AnswerEvaluationAgent._stem(kt) for kt in key_terms]
            hits = sum(1 for ks in key_stems if ks in answer_stems)
            # A single defining word present (e.g. "bottleneck", "GAN") is
            # often enough evidence the concept was referenced -- require
            # just over half the words for multi-word terms, and any one
            # word for short (1-2 word) terms rather than demanding all.
            required_ratio = 0.5 if len(key_stems) <= 2 else 0.45
            min_hits = 1 if len(key_stems) <= 2 else max(1, round(len(key_stems) * required_ratio))
            if hits >= min_hits:
                found.append(term_clean)
            else:
                missing.append(term_clean)
        return found, missing

    @staticmethod
    def _match_diagrams(diagram_labels: list, student_answer: str) -> tuple:
        """
        OCR text can't truly detect a hand-drawn diagram's presence,
        so this checks for a textual signal that a diagram/labels were
        described or referenced (a reasonable proxy given text-only
        evaluation). Always flags diagrams as "missing" if none were
        expected-signal-wise -- this is intentionally conservative
        since diagrams carry real marks.
        """
        if not diagram_labels:
            return [], []
        answer_lower = student_answer.lower()
        found, missing = [], []
        for label in diagram_labels:
            label_clean = str(label).strip()
            if not label_clean:
                continue
            key_terms = re.findall(r"[A-Za-z]{3,}", label_clean.lower())
            mentions_diagram_word = bool(re.search(r"\b(diagram|figure|fig\.?|sketch|drawn below|shown below)\b", answer_lower))
            hits = sum(1 for kt in key_terms if kt in answer_lower) if key_terms else 0
            required_ratio = 1.0 if len(key_terms) <= 2 else 0.6
            label_referenced = bool(key_terms) and (hits / len(key_terms) >= required_ratio)
            if mentions_diagram_word and label_referenced:
                found.append(label_clean)
            else:
                missing.append(label_clean)
        return found, missing

    @staticmethod
    def _compose_feedback(percentage, relevance, missing_concepts, missing_keywords, justification: str = "") -> str:
        if percentage >= 90:
            base = "Excellent, comprehensive answer covering the required concepts."
        elif percentage >= 75:
            base = "Very good answer with strong coverage of the topic."
        elif percentage >= 60:
            base = "Good answer; covers the main points but has some gaps."
        elif percentage >= 40:
            base = "Partial answer; several important concepts are missing."
        else:
            base = "Weak answer; most of the expected content is missing."

        extra = []
        if justification:
            extra.append(justification)
        else:
            if missing_concepts:
                extra.append(f"Missing concept(s): {', '.join(missing_concepts[:4])}.")
            if missing_keywords:
                extra.append(f"Missing keyword(s): {', '.join(missing_keywords[:4])}.")

        return " ".join([base] + extra)
