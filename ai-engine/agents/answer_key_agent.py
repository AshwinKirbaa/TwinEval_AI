"""
AnswerKeyAgent: generates a complete, structured model answer key for a
single exam question -- no manual answer key entry required from the
teacher.

Generation backend: if a GEMINI_API_KEY is set (get a free one at
https://aistudio.google.com/apikey and put it in a .env file as
GEMINI_API_KEY=...), this uses Google's free Gemini API (gemini-2.0-flash),
which is much faster than a local model on modest hardware. If no key is
set, or the Gemini call fails for any reason, it transparently falls
back to the local Ollama model -- so this always works offline too, just
slower.

The generated key covers everything the evaluation pipeline needs:
model answer, keywords, concepts, expected points, advantages/
disadvantages, applications, algorithm/steps, formulae, required
diagrams, Bloom's level, and a question-wise marking rubric that sums
to the question's max marks.
"""
import json
import os
import re

from dotenv import load_dotenv

from utils import ollama_client

from models.question import AnswerKey

load_dotenv()

# Below this many marks, a question is treated as "objective" (short,
# direct-answer) by default even without any other signal -- a 0.5-2
# mark item is essentially never a multi-paragraph essay question.
_OBJECTIVE_MARKS_THRESHOLD = 1.0

# Phrasing/structure that signals a True/False, multiple-choice, or
# fill-in-the-blank style question regardless of its marks.
_OBJECTIVE_PATTERN_RE = re.compile(
    r"""
        \btrue\s*(?:or|/)\s*false\b
      | \bstate\s+(?:whether|true)\b
      | \bfill\s+in\s+the\s+blanks?\b
      | \bchoose\s+the\s+(?:correct|best|right)\b
      | \bmultiple\s+choice\b
      | \bwhich\s+of\s+the\s+following\b
      | \bselect\s+the\s+correct\b
      | \bpick\s+the\s+correct\b
      | \bone[-\s]word\s+answer\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# An enumerated options list, e.g. "a) ... b) ... c) ..." or
# "(a) ... (b) ... (c) ...", seen at least twice -- a strong signal
# this is a multiple-choice question even without explicit wording.
_OPTION_MARKER_RE = re.compile(r"(?:^|\n)\s*\(?[a-dA-D]\)\s+\S", re.MULTILINE)

_OBJECTIVE_JSON_SCHEMA_EXAMPLE = """{
  "model_answer": "The single correct answer stated concisely, e.g. 'True' or 'Option B: Bottleneck layer' or 'Backpropagation'.",
  "keywords": ["the 1-3 key term(s) that must appear in a correct student answer"],
  "bloom_level": "One of: Remember, Understand, Apply, Analyze, Evaluate, Create",
  "rubric": {
    "correct_answer": 1
  }
}"""

_JSON_SCHEMA_EXAMPLE = """{
  "model_answer": "Full, well-structured model answer text as a teacher would write it.",
  "keywords": ["keyword1", "keyword2"],
  "concepts": ["concept1", "concept2"],
  "expected_points": ["point 1 the answer must cover", "point 2 ..."],
  "advantages": ["advantage 1", "advantage 2"],
  "disadvantages": ["disadvantage 1"],
  "applications": ["real-world application 1"],
  "steps": ["step 1 of algorithm/procedure, if applicable", "step 2 ..."],
  "formulae": ["formula 1, if applicable"],
  "diagrams": ["name/label of a diagram this answer should include, if applicable"],
  "bloom_level": "One of: Remember, Understand, Apply, Analyze, Evaluate, Create",
  "rubric": {
    "concept_coverage": 3,
    "keywords": 1,
    "technical_correctness": 2,
    "completeness": 1,
    "logical_flow": 1,
    "advantages_disadvantages": 1,
    "applications": 0.5,
    "formulae_or_algorithm": 0.5,
    "diagram": 0
  }
}"""


def _is_objective_question(question_text: str, max_marks: float) -> bool:
    """
    Decides whether `question_text` is a short, objective-style question
    (True/False, multiple choice, fill-in-the-blank, one-word/one-line
    factual answer) that should get a short, direct answer key instead
    of the full essay-style schema.

    Signals, any one of which is sufficient:
      - Explicit objective phrasing ("True or False", "choose the
        correct option", "fill in the blank", etc).
      - An enumerated options list (a)/(b)/(c)/(d) appearing 2+ times.
      - Very low marks (<= _OBJECTIVE_MARKS_THRESHOLD) -- a 0.5-1 mark
        item is essentially never meant to be answered with an essay.
    """
    if max_marks <= _OBJECTIVE_MARKS_THRESHOLD:
        return True
    if _OBJECTIVE_PATTERN_RE.search(question_text):
        return True
    if len(_OPTION_MARKER_RE.findall(question_text)) >= 2:
        return True
    return False


class AnswerKeyAgent:

    def __init__(self, model: str = "qwen3:4b-instruct", gemini_model: str = "gemini-2.0-flash"):
        self.model = model
        self.gemini_model = gemini_model

    def generate(self, question_text: str, topic: str = "", max_marks: float = 10.0) -> dict:
        """
        Returns a dict compatible with models.question.AnswerKey.from_dict().
        Falls back to a minimal-but-usable answer key if the model
        output can't be parsed, so the pipeline never hard-fails.
        """
        question_text = (question_text or "").strip()
        if not question_text:
            return AnswerKey(question_id="").to_dict()

        objective = _is_objective_question(question_text, max_marks)
        prompt = (
            self._build_objective_prompt(question_text, topic, max_marks)
            if objective
            else self._build_subjective_prompt(question_text, topic, max_marks)
        )

        if os.getenv("GEMINI_API_KEY"):
            try:
                return self._generate_gemini(prompt, max_marks)
            except Exception as e:
                print(f"AnswerKeyAgent: Gemini generation failed ({e}), falling back to Ollama")

        try:
            # JSON mode prevents the most common failure here: a long-form
            # model wrapping/truncating its answer around the requested JSON.
            # A 14-mark answer legitimately needs longer than the old global
            # 90-second limit on CPU, so answer generation gets its own bound.
            answer_timeout = float(os.environ.get("OLLAMA_ANSWER_KEY_TIMEOUT_SECONDS", "240"))
            for attempt in range(2):
                messages = [{"role": "user", "content": prompt}]
                if attempt:
                    messages.append({
                        "role": "user",
                        "content": "Your previous response was missing or invalid. Return one complete JSON object with a non-empty model_answer now."
                    })
                response = ollama_client.chat(
                    model=self.model,
                    messages=messages,
                    options={"temperature": 0.1, "top_p": 0.9, "num_predict": 3072, "num_ctx": 8192},
                    timeout=answer_timeout,
                    retries=1,
                    format="json",
                )
                content = response["message"]["content"].strip()
                parsed = self._parse_json(content)
                if parsed and str(parsed.get("model_answer", "")).strip():
                    return self._normalize(parsed, max_marks)
            raise ValueError("The local model returned incomplete JSON twice.")
        except Exception as e:
            err_msg = str(e).lower()
            if "not found" in err_msg or "404" in err_msg:
                try:
                    ollama_client.pull(self.model)
                    return self.generate(question_text, topic, max_marks)
                except Exception as pull_err:
                    print(f"AnswerKeyAgent: model pull failed: {pull_err}")
            print(f"AnswerKeyAgent generation failed, using fallback key: {e}")

        fallback = self._fallback(question_text, max_marks)
        fallback["generation_error"] = (
            f"The local model '{self.model}' could not generate this answer key. "
            "Retry generation after checking Ollama."
        )
        return fallback

    @staticmethod
    def _build_objective_prompt(question_text: str, topic: str, max_marks: float) -> str:
        return f"""You are an expert subject teacher preparing an answer key for a SHORT, OBJECTIVE exam question (True/False, multiple choice, fill-in-the-blank, or a one-line factual question). This question is worth only {max_marks:g} mark(s), so the answer key must be short and direct.

Question{f" (topic: {topic})" if topic else ""}:
\"\"\"{question_text}\"\"\"

Rules:
- If the question presents multiple options (True/False, (a)/(b)/(c)/(d), etc.), identify and state ONLY the single correct option/answer -- do not restate all the options or explain why the others are wrong unless the question explicitly asks for a reason.
- Do NOT write an essay. Do NOT include concepts, advantages, disadvantages, applications, steps, formulae, or diagrams -- none of those apply to a question this short.
- "model_answer" must be just the correct answer itself (a word, a short phrase, or at most one short sentence).

Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this schema:
{_OBJECTIVE_JSON_SCHEMA_EXAMPLE}
"""

    @staticmethod
    def _build_subjective_prompt(question_text: str, topic: str, max_marks: float) -> str:
        if max_marks <= 4:
            depth_guidance = (
                f"This question is worth only {max_marks:g} marks -- keep the model answer brief and "
                "focused (a few sentences covering only the essential point(s)). Only include the 2-3 "
                "rubric criteria that actually apply; omit the rest rather than padding the key with "
                "sections this short a question doesn't need."
            )
        elif max_marks <= 7:
            depth_guidance = (
                f"This question is worth {max_marks:g} marks -- give a moderately detailed answer that "
                "covers the main points clearly, without unnecessary padding."
            )
        else:
            depth_guidance = (
                f"This question is worth {max_marks:g} marks -- give a comprehensive, well-structured "
                "answer covering all relevant aspects in appropriate depth."
            )

        return f"""You are an expert university subject teacher preparing a model answer key for grading student exam answers.

Question{f" (topic: {topic})" if topic else ""}:
\"\"\"{question_text}\"\"\"

Total marks for this question: {max_marks:g}

{depth_guidance}

Only include fields that genuinely apply to THIS question (e.g. leave "formulae" empty for a purely descriptive question; leave "diagrams" empty if no diagram is expected; leave "advantages"/"disadvantages" empty if the question isn't asking to compare or evaluate something). Do not invent content for a section just to fill it in -- an empty list is correct when a section doesn't apply.

The "rubric" values are the marks (out of {max_marks:g} total) allocated to each grading criterion actually relevant to this question -- they must sum to exactly {max_marks:g}. Omit rubric keys that don't apply to this question rather than giving them 0.

Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this schema:
{_JSON_SCHEMA_EXAMPLE}
"""

    def _generate_gemini(self, prompt: str, max_marks: float) -> dict:
        """Fast path: Google's free Gemini API. Raises on any failure so
        the caller can fall back to local Ollama."""
        from google import genai

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        response = client.models.generate_content(model=self.gemini_model, contents=prompt)
        content = (response.text or "").strip()
        parsed = self._parse_json(content)
        if not parsed:
            raise ValueError(f"Gemini returned unparseable content: {content[:200]}")
        return self._normalize(parsed, max_marks)

    # -------------------------------------------------------
    # Helpers
    # -------------------------------------------------------

    @staticmethod
    def _parse_json(content: str):
        content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.MULTILINE).strip()
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            content = match.group(0)
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _normalize(data: dict, max_marks: float) -> dict:
        def _list(key):
            val = data.get(key, [])
            if isinstance(val, list):
                return [str(v).strip() for v in val if str(v).strip()]
            if isinstance(val, str) and val.strip():
                return [val.strip()]
            return []

        rubric = data.get("rubric", {})
        rubric = {k: float(v) for k, v in rubric.items()} if isinstance(rubric, dict) else {}

        # Guard against the model's rubric not summing to max_marks --
        # rescale proportionally so downstream scoring is always fair.
        rubric_total = sum(rubric.values())
        if rubric_total > 0 and abs(rubric_total - max_marks) > 0.05:
            scale = max_marks / rubric_total
            rubric = {k: round(v * scale, 2) for k, v in rubric.items()}

        # Rounding each criterion independently can leave a one-cent mark
        # mismatch.  Correct the largest criterion so the rubric denominator
        # is mathematically identical to the question's max marks.
        if rubric:
            rounded_total = round(sum(rubric.values()), 2)
            diff = round(max_marks - rounded_total, 2)
            if abs(diff) > 0.0:
                largest = max(rubric, key=rubric.get)
                rubric[largest] = round(max(0.0, rubric[largest] + diff), 2)

        if not rubric:
            rubric = {"concept_coverage": max_marks}

        bloom = str(data.get("bloom_level", "Understand")).strip().title()
        if bloom not in ("Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"):
            bloom = "Understand"

        return {
            "model_answer": str(data.get("model_answer", "")).strip(),
            "keywords": _list("keywords"),
            "concepts": _list("concepts"),
            "expected_points": _list("expected_points"),
            "advantages": _list("advantages"),
            "disadvantages": _list("disadvantages"),
            "applications": _list("applications"),
            "steps": _list("steps"),
            "formulae": _list("formulae"),
            "diagrams": _list("diagrams"),
            "bloom_level": bloom,
            "rubric": rubric,
        }

    @staticmethod
    def _fallback(question_text: str, max_marks: float) -> dict:
        """Minimal usable answer key when the LLM call/parse fails, so
        the rest of the pipeline can still run (with a warning surfaced
        to the teacher in the UI)."""
        keywords = [w.strip(".,?:;") for w in question_text.split() if len(w.strip(".,?:;")) > 4][:8]

        if _is_objective_question(question_text, max_marks):
            # Keep it minimal -- an essay-shaped fallback for a
            # True/False or one-line question would be just as
            # "unwanted" as a bad LLM response would have been.
            return {
                "model_answer": "",
                "keywords": keywords[:3],
                "concepts": [],
                "expected_points": [],
                "advantages": [],
                "disadvantages": [],
                "applications": [],
                "steps": [],
                "formulae": [],
                "diagrams": [],
                "bloom_level": "Remember",
                "rubric": {"correct_answer": max_marks},
            }

        return {
            "model_answer": "",
            "keywords": keywords,
            "concepts": keywords[:5],
            "expected_points": [],
            "advantages": [],
            "disadvantages": [],
            "applications": [],
            "steps": [],
            "formulae": [],
            "diagrams": [],
            "bloom_level": "Understand",
            "rubric": {"concept_coverage": max_marks},
        }
