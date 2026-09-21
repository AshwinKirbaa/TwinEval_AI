"""
StudentAnswerAgent: splits a student's combined, OCR'd answer-sheet
text (which may span multiple uploaded files/pages) into per-question
answers, matched up against the teacher's Question list.

Same fast-regex-first, LLM-fallback strategy as QuestionAgent, tuned
for how students typically mark their answers ("Ans 1:", "Answer to
Q2", "1)", "Q.No 3", etc).
"""
import json
import re

from utils import ollama_client

_ANSWER_MARKER_RE = re.compile(
    r"""^\s*
        (?:Ans(?:wer)?\.?\s*(?:to\s*)?(?:Q(?:uestion)?\.?\s*)?|Q(?:uestion)?\.?\s*(?:No\.?)?\s*)?
        (\d{1,2})
        (?:
            \s*[\.\)]\s*([a-zA-Z])\s*[\)\.\:]\s*  # 19.a), 19. a), 19)a)
            |
            [\.\)\:]\s+                              # 19., 19), 19:
        )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# A standalone "Part A" / "Part - B" / "PART-C" / "Part: D" style section
# divider -- students often copy these headings onto their own answer
# sheet to mark where a new part of the paper begins. It carries no
# question content of its own and must never be appended onto whichever
# question happened to precede it.
_PART_LABEL_RE = re.compile(r"^\s*part\s*[\.\-:]?\s*[a-zA-Z]\s*[\.\-:]?\s*$", re.IGNORECASE)


class StudentAnswerAgent:

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model

    def split_answers(self, raw_text: str, num_questions: int) -> dict:
        """
        Returns {question_index (1-based int): answer_text}.
        question_index is a 1-based position, matched to the teacher's
        question list by order (question numbers on an answer sheet
        are assumed to correspond to the question paper's order).
        """
        raw_text = (raw_text or "").strip()
        if not raw_text:
            return {}

        if num_questions <= 1:
            # Nothing to split -- the whole submission answers the one question.
            return {1: raw_text}

        answers = self._split_by_regex(raw_text, num_questions)

        if len(answers) >= max(2, num_questions // 2):
            return answers

        if len(raw_text) > 250:
            llm_answers = self._split_by_llm(raw_text, num_questions)
            if len(llm_answers) >= max(2, num_questions // 2):
                return llm_answers

        # Couldn't confidently split -- fall back to treating the whole
        # text as the answer to question 1 (better than silently
        # discarding the student's work; the UI surfaces a warning so
        # the teacher/student can re-check).
        return answers if answers else {1: raw_text}

    # -------------------------------------------------------
    # Regex-based splitting
    # -------------------------------------------------------

    def _split_by_regex(self, raw_text: str, num_questions: int) -> dict:
        """
        Walks the text line by line, starting a NEW answer only when a
        line looks like a genuine "next question" marker: a number that
        is (a) no greater than the paper's total question count, and
        (b) strictly greater than the question we're currently on (or
        the very first marker seen, if none has started yet).

        This monotonically-increasing constraint is what keeps this
        reliable on real answer sheets. Without it, any line elsewhere
        in the document that happens to start with a bare "1.", "2.",
        etc. -- a numbered sub-step inside a later essay answer, a
        restarted list, stray OCR noise -- gets misread as a new
        top-level question marker and spliced onto the WRONG (earlier)
        question's answer instead of staying part of whatever question
        it actually belongs to. Requiring each new marker to move the
        question number strictly forward means a reused/out-of-order
        number is correctly treated as ordinary continuation text of
        the answer currently being read.
        """
        lines = raw_text.splitlines()
        answers = {}
        current_q = None          # output slot, 1-based
        current_source_q = None   # printed question number
        current_subpart = None    # printed subpart, e.g. a/b
        current_lines = []

        def flush():
            if current_q is not None and current_lines:
                text = "\n".join(current_lines).strip()
                if text:
                    answers[current_q] = (answers.get(current_q, "") + "\n" + text).strip() if current_q in answers else text

        for line in lines:
            if _PART_LABEL_RE.match(line):
                # A bare "Part A" / "Part - B" section divider on the
                # student's own sheet -- structure, not answer content.
                continue

            match = _ANSWER_MARKER_RE.match(line)
            candidate = int(match.group(1)) if match else None
            subpart = match.group(2).lower() if match and match.group(2) else None

            is_new_marker = False
            next_slot = current_q

            if candidate is not None:
                if current_q is None:
                    # For the first marker, preserve the printed question
                    # number when it is within the paper's range.
                    if 1 <= candidate <= num_questions:
                        next_slot = candidate
                        is_new_marker = True
                elif candidate > current_source_q:
                    # Normal next question.  If earlier compound subparts
                    # made the internal slot advance, continue sequentially
                    # rather than jumping backwards to the printed number.
                    next_slot = max(candidate, current_q + 1)
                    is_new_marker = next_slot <= num_questions
                elif candidate == current_source_q and subpart and current_subpart and subpart > current_subpart:
                    # Alternative pair such as 19.a) / 19.b).  These are
                    # separate Question rows in the paper, so map the second
                    # subpart to the next output slot.
                    next_slot = current_q + 1
                    is_new_marker = next_slot <= num_questions

            if is_new_marker:
                flush()
                current_q = next_slot
                current_source_q = candidate
                current_subpart = subpart
                remainder = _ANSWER_MARKER_RE.sub("", line, count=1)
                current_lines = [remainder] if remainder.strip() else []
            elif current_q is not None:
                current_lines.append(line)
            # else: text before the first valid answer marker is ignored.

        flush()
        return answers

    # -------------------------------------------------------
    # LLM-based splitting (fallback)
    # -------------------------------------------------------

    def _split_by_llm(self, raw_text: str, num_questions: int) -> dict:
        prompt = f"""You are given raw OCR text from a student's handwritten/printed exam answer sheet, containing answers to {num_questions} numbered questions. The numbering or OCR quality may be imperfect.

Split the text into each question's answer. Do not rewrite, correct, or summarize the content -- copy each answer as close to verbatim as possible, preserving the student's own words.

Return ONLY a valid JSON object mapping question number (as a string) to that question's answer text, nothing else. Example:
{{"1": "answer text for question 1...", "2": "answer text for question 2..."}}

Text:
\"\"\"
{raw_text}
\"\"\"
"""
        try:
            response = ollama_client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0.1},
            )
            content = response["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.MULTILINE).strip()
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                content = match.group(0)
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return {int(k): str(v).strip() for k, v in parsed.items() if str(v).strip() and str(k).isdigit()}
        except Exception as e:
            print(f"StudentAnswerAgent LLM split failed, falling back: {e}")

        return {}
