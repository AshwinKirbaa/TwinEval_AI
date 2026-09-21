"""
QuestionAgent: turns raw question-paper text (typed manually, or OCR'd
from an uploaded PDF/image question paper) into a clean list of
individual Question objects.

Strategy: try fast, deterministic regex splitting first (numbered
questions are the overwhelming common case: "1.", "Q1.", "Q.1)",
"1)"). Only fall back to an LLM-based split (via local Ollama) when
regex clearly didn't find a sane number of questions -- keeps things
fast and fully offline-capable even without a very reliable OCR text
layer.
"""
import json
import re

from utils import ollama_client


# Matches a new-question marker at the start of a line, e.g.:
#   "1.", "1)", "Q1.", "Q.1)", "Q1)", "Question 1:"
_QUESTION_MARKER_RE = re.compile(
    r"""^\s*
        (?:Q(?:uestion)?\.?\s*)?      # optional "Q" / "Question" prefix
        (\d{1,2})                       # question number
        (?:
            \s*[\.\)]\s*[a-zA-Z]\s*[\)\.\:]\s*  # 19.a), 19. a), 19)a)
            |
            [\.\)\:]\s+                              # 19., 19), 19:
        )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Matches a section/part header's marks formula, e.g.:
#   "Part A - (12*0.5=6 Marks)"  ->  12 questions follow, 0.5 marks each
#   "Part B - (3*2=6 Marks)"     ->  3 questions follow, 2 marks each
# Both factors matter: the first is how many questions in this section
# count toward the section's total (used directly, regardless of any
# "Answer any N questions" instruction wording -- some papers print the
# pool size first even when phrased as a choice, e.g. "Answer any two
# questions" over a header reading "(3*2=6 Marks)": that paper's own
# arithmetic makes clear all 3 are meant to be graded and summed, 3*2=6,
# not 2*2=4). The second, right before "=", is the per-question mark.
_SECTION_HEADER_RE = re.compile(
    r"""\(\s*(\d{1,3})\s*\*\s*(\d{1,3}(?:\.\d+)?)\s*=\s*\d{1,4}(?:\.\d+)?\s*(?:marks?)?\s*\)""",
    re.IGNORECASE,
)

# Alternate wording commonly found in OCR'd papers: "10 marks each" or
# "10 marks per question".
_SECTION_EACH_MARKS_RE = re.compile(
    r"\b(\d{1,3}(?:\.\d+)?)\s*marks?\s*(?:each|per\s+question)\b",
    re.IGNORECASE,
)

# Matches an "Answer any two questions" / "Answer any 2 questions" style
# instruction line that precedes a Part header -- means only N of the
# questions that follow (until the next such instruction, or "Answer
# all the questions") should count towards the section's marks.
_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
_ANY_N_RE = re.compile(
    r"""\banswer\s+any\s+(\w+)\s+questions?\b""",
    re.IGNORECASE,
)
_ANSWER_ALL_RE = re.compile(r"""\banswer\s+(?:all\s+)?(?:the\s+)?questions?\b""", re.IGNORECASE)

# A standalone "(OR)" / "(or)" line separating two alternative
# sub-questions (e.g. "19. a) ... (OR) 19. b) ...") -- only one of the
# two needs to be (and should be) answered.
_OR_MARKER_RE = re.compile(r"""^\s*\(?\s*or\s*\)?\s*$""", re.IGNORECASE)


def _parse_any_n(text: str):
    m = _ANY_N_RE.search(text)
    if not m:
        return None
    token = m.group(1).strip().lower()
    if token.isdigit():
        return int(token)
    return _NUMBER_WORDS.get(token)

# Matches a per-question marks annotation, e.g.:
#   "[10 Marks]", "(5 Marks)", "[10M]", or a bare trailing "10 Marks".
# Only used to *find* the marks value for a question and strip it back
# out of the question text -- an inline annotation like this on a
# specific question always overrides a section header's default (see
# _SECTION_HEADER_RE above), since it's more specific.
_MARKS_RE = re.compile(
    r"""
        [\[\(] \s* (\d{1,3}(?:\.\d+)?) \s* (?:marks?|m) \s* [\]\)]
        |
        \b (\d{1,3}(?:\.\d+)?) \s* marks? \b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Trailing paper boilerplate that sometimes ends up glued onto the last
# question when it's the final thing on the page -- not part of any
# question, so it should never be kept as "question text".
_FOOTER_BOILERPLATE_RE = re.compile(
    r"""^\s*(\*{2,}\s*)?(all the best|end of (the )?question paper|-+\s*end\s*-+)\s*(\*{2,})?\s*$""",
    re.IGNORECASE,
)


def _extract_marks(text: str):
    """
    Finds a per-question marks annotation in `text` (if any) and returns
    (text_with_annotation_removed, marks_as_float_or_None).

    Only the LAST match is used -- marks are almost always stated once,
    right after the question number or at the very end of the question
    -- so we don't risk grabbing a number the question happens to
    mention in its own wording (e.g. "list 10 marks awarded per round"
    type edge cases are rare, but taking the last/most-trailing match
    keeps the common "question text ... [10 Marks]" case reliable).
    """
    matches = list(_MARKS_RE.finditer(text))
    if not matches:
        return text, None

    m = matches[-1]
    value = m.group(1) or m.group(2)
    try:
        marks = float(value)
    except (TypeError, ValueError):
        return text, None

    cleaned = text[: m.start()] + text[m.end():]
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, marks


_FOOTER_METADATA_PATTERNS = (
    re.compile(r"\bcourse[- ]?outcome\b", re.IGNORECASE),
    re.compile(r"\bbloom(?:'s|s)?(?:\s+level)?\b", re.IGNORECASE),
    re.compile(r"\bstaff\s*i\s*/\s*c\b", re.IGNORECASE),
    re.compile(r"\bPAC\b", re.IGNORECASE),
    re.compile(r"\bHOD\b", re.IGNORECASE),
    re.compile(r"\bIQAC\b", re.IGNORECASE),
    re.compile(r"\bCO\s*\d+\s*[:=-]", re.IGNORECASE),
    re.compile(r"\bPO\s*\d+\s*[:=-]", re.IGNORECASE),
    re.compile(r"\bPSO\s*\d+\s*[:=-]", re.IGNORECASE),
)


def _metadata_hits(text: str) -> int:
    return sum(bool(pattern.search(text)) for pattern in _FOOTER_METADATA_PATTERNS)


def _strip_footer_boilerplate(text: str) -> str:
    """Remove common exam-paper footer/mapping tables from extracted text.

    Operates on the whole text as one block rather than line-by-line.
    Real OCR/PDF text extraction is inconsistent about whether a
    footer ends up on its own line(s) or glued onto the same line as
    the actual question content (common with two-column PDF layouts) --
    a per-line-only check either fails to strip a glued footer, or
    (worse) discards real question text that happens to share a line
    with where the footer starts.

    Finds the earliest position where a metadata marker (Staff I/C,
    PAC, HOD, IQAC, a CO/PO/PSO mapping, the Bloom's-level legend, etc.)
    begins, such that everything from that point to the end of the text
    contains at least two distinct markers -- confirming it's genuinely
    a footer block and not an isolated, legitimate mention of one term
    within the question itself -- and truncates there, keeping only
    what comes before.
    """
    # Explicit end markers ("All the best", "End of question paper") are
    # still handled as a simple trailing-line strip first.
    lines = text.splitlines()
    while lines and _FOOTER_BOILERPLATE_RE.match(lines[-1]):
        lines.pop()
    text = "\n".join(lines)

    positions = []
    for pattern in _FOOTER_METADATA_PATTERNS:
        m = pattern.search(text)
        if m:
            positions.append(m.start())

    for pos in sorted(positions):
        if _metadata_hits(text[pos:]) >= 2:
            return text[:pos].rstrip()

    return text.strip()


class QuestionAgent:

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model

    # -------------------------------------------------------
    # Public API
    # -------------------------------------------------------

    def split_question_paper(self, raw_text: str) -> list:
        """
        Returns a list of dicts, one per question, in original order:
            {"text": <question text, marks annotation stripped out>,
             "marks": <float, or None if no marks could be determined>}

        Marks priority for each question:
          1. An inline annotation on that specific question, e.g.
             "[10 Marks]" right on the question itself.
          2. The most recent section header's per-question mark, e.g.
             "Part A - (12*0.5=6 Marks)" applies 0.5 to every question
             that follows it, until the next such header.
          3. None (the caller falls back to a default).

        Only the question heading/number, the question text itself, and
        its marks are kept -- paper headers, instructions, section
        markers, and footer boilerplate that aren't part of any
        individual question are discarded rather than being kept as
        "unwanted details" or mistaken for an extra question.
        """
        raw_text = (raw_text or "").strip()
        if not raw_text:
            return []

        question_chunks = self._split_by_regex(raw_text)

        if len(question_chunks) < 2 and len(raw_text) > 250:
            # Regex found 0 or 1 question -- if the text is long, this is
            # suspicious (a real question paper usually has several
            # questions). Try an LLM-based split as a fallback. (The LLM
            # path doesn't track section headers, so those questions
            # fall back to priority 3 above.)
            llm_questions = self._split_by_llm(raw_text)
            if len(llm_questions) >= 2:
                question_chunks = [{"text": t, "section_marks": None} for t in llm_questions]

        if not question_chunks:
            # Nothing better found -- treat the whole text as one
            # question (also covers manual entry of a single question).
            question_chunks = [{"text": raw_text, "section_marks": None}]

        results = []
        for index, chunk in enumerate(question_chunks):
            # Footer cleanup must happen BEFORE marks extraction; otherwise a
            # trailing mapping table can accidentally supply the question's
            # last numeric "Marks" value.  Generic CO/Bloom footer
            # detection is applied only to the final question to avoid
            # deleting a legitimate earlier question about those terms.
            cleaned = (_strip_footer_boilerplate(chunk["text"])
                       if index == len(question_chunks) - 1
                       else chunk["text"])
            cleaned, inline_marks = _extract_marks(cleaned)
            marks = inline_marks if inline_marks is not None else chunk.get("section_marks")
            if cleaned.strip():
                results.append({
                    "text": cleaned.strip(),
                    "marks": marks,
                    "group_id": chunk.get("group_id"),
                    "group_required": chunk.get("group_required"),
                })
        return results

    # -------------------------------------------------------
    # Regex-based splitting
    # -------------------------------------------------------

    def _split_by_regex(self, raw_text: str) -> list:
        lines = raw_text.splitlines()
        chunks = []
        current = None  # None until the first question marker is seen
        current_section_marks = None
        pending_section_marks = None  # set by the most recent header seen so far
        current_group_id = None
        current_group_required = None

        # "Answer any N questions" group tracking: pending_any_n is the N
        # seen on an instruction line, waiting to be attached to the next
        # Part header's group scope. active_group_id/active_group_required
        # apply to every question chunk *opened* after that header, until
        # the next Part header changes them again.
        pending_any_n = None
        active_group_id = None
        active_group_required = None
        group_counter = 0

        # "(OR)" linking: a standalone "(OR)" line closes the chunk in
        # progress (e.g. "19.a) ...") and tags it into a fresh required-
        # 1-of-2 group; pending_or_group_id then carries that same group
        # id forward so it gets applied to whichever chunk opens next
        # (e.g. "19.b) ..."), regardless of how many lines are in between.
        pending_or_group_id = None

        def close_current():
            nonlocal current, current_section_marks
            if current is None:
                return None
            chunk = {
                "text": "\n".join(current).strip(),
                "section_marks": current_section_marks,
                "group_id": current_group_id,
                "group_required": current_group_required,
            }
            chunks.append(chunk)
            current = None
            return chunk

        for line in lines:
            any_n = _parse_any_n(line)
            header_match = _SECTION_HEADER_RE.search(line)
            each_marks_match = _SECTION_EACH_MARKS_RE.search(line) if not header_match else None

            # A section header can contain the choice instruction itself,
            # e.g. "Part C - Answer any 2 questions (3*10=30 Marks)".  The
            # previous implementation consumed the line as soon as it saw
            # "Answer any 2", so it never recorded either the section marks
            # or the choice group.
            if any_n:
                pending_any_n = any_n

            if _ANSWER_ALL_RE.search(line):
                pending_any_n = None
                active_group_id = None
                active_group_required = None

            if header_match or each_marks_match:
                if header_match:
                    pool_count = int(header_match.group(1))
                    pending_section_marks = float(header_match.group(2))
                else:
                    # "10 marks each" has no embedded pool count of its
                    # own -- fall back to whatever "Answer any N
                    # questions" instruction preceded it, if any.
                    pool_count = pending_any_n
                    pending_section_marks = float(each_marks_match.group(1))

                if pool_count:
                    group_counter += 1
                    active_group_id = f"section-{group_counter}"
                    active_group_required = pool_count
                else:
                    active_group_id = None
                    active_group_required = None
                pending_any_n = None
                continue  # a header line is paper structure, never question content

            if any_n or _ANSWER_ALL_RE.search(line):
                continue  # instruction line is paper structure, never question content

            if _OR_MARKER_RE.match(line):
                closed = close_current()
                if closed is not None:
                    group_counter += 1
                    or_id = f"or-{group_counter}"
                    closed["group_id"] = or_id
                    closed["group_required"] = 1
                    pending_or_group_id = or_id
                continue  # the "(OR)" marker itself is never question content

            if _QUESTION_MARKER_RE.match(line):
                close_current()
                current = [_QUESTION_MARKER_RE.sub("", line, count=1)]
                current_section_marks = pending_section_marks
                if pending_or_group_id is not None:
                    current_group_id = pending_or_group_id
                    current_group_required = 1
                    pending_or_group_id = None
                else:
                    current_group_id = active_group_id
                    current_group_required = active_group_required
            elif current is not None:
                current.append(line)
            # else: line appears before the first question marker (e.g.
            # paper header, "Time: 3 hrs", "Answer all questions") --
            # discard it, it isn't part of any question and shouldn't
            # become a bogus first "question".

        close_current()

        return [c for c in chunks if c["text"].strip()]

    # -------------------------------------------------------
    # LLM-based splitting (fallback for irregular formatting/OCR noise)
    # -------------------------------------------------------

    def _split_by_llm(self, raw_text: str) -> list:
        prompt = f"""You are given raw text extracted from an exam question paper (it may contain OCR noise, headers, or irregular numbering).

Split it into individual exam questions. Do not rewrite, translate, or correct the wording -- copy each question as close to verbatim as possible. Ignore non-question content like headers, instructions, marks allocation tables, or footers.

Return ONLY a valid JSON array of strings, one string per question, nothing else. Example:
["Explain the OSI model with a diagram.", "What are the advantages of normalization?"]

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

            match = re.search(r"\[.*\]", content, re.DOTALL)
            if match:
                content = match.group(0)

            parsed = json.loads(content)
            if isinstance(parsed, list):
                return [str(q).strip() for q in parsed if str(q).strip()]
        except Exception as e:
            print(f"QuestionAgent LLM split failed, falling back: {e}")

        return []
