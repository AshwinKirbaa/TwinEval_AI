"""
TopicRelevanceAgent: guards against awarding marks to answers that are
well-written but about the wrong topic entirely (e.g. student answers
a different question, or a semantically-nearby-but-distinct topic).

Uses the local Ollama model for a fast relevance judgement, with a
deterministic keyword-overlap heuristic as a fallback if the LLM call
or JSON parsing fails, so this gate never crashes the pipeline.
"""
import json
import re

from utils import ollama_client


class TopicRelevanceAgent:

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model

    def check(self, question_text: str, student_answer: str) -> dict:
        """
        Returns: {"is_relevant": bool, "relevance_score": float (0-1), "reason": str}
        """
        question_text = (question_text or "").strip()
        student_answer = (student_answer or "").strip()

        if not student_answer:
            return {"is_relevant": False, "relevance_score": 0.0, "reason": "No answer provided."}

        prompt = f"""You are an examiner checking whether a student's answer is actually about the question asked -- NOT whether it is correct or complete, only whether it addresses the right topic.

Question:
\"\"\"{question_text}\"\"\"

Student's Answer:
\"\"\"{student_answer}\"\"\"

If the answer is about a clearly different topic/question (even if well-written, technically correct about that other topic, or superficially similar), it must be marked NOT relevant.

Return ONLY valid JSON, no markdown fences, exactly in this form:
{{"is_relevant": true, "relevance_score": 0.95, "reason": "brief one-sentence reason"}}
"""
        try:
            response = ollama_client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0, "top_p": 0.1},
            )
            content = response["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.MULTILINE).strip()
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                content = match.group(0)
            parsed = json.loads(content)

            score = float(parsed.get("relevance_score", 0.5))
            score = max(0.0, min(1.0, score))
            return {
                "is_relevant": bool(parsed.get("is_relevant", score >= 0.5)),
                "relevance_score": score,
                "reason": str(parsed.get("reason", "")).strip(),
            }
        except Exception as e:
            print(f"TopicRelevanceAgent LLM check failed, using keyword fallback: {e}")
            return self._keyword_fallback(question_text, student_answer)

    @staticmethod
    def _keyword_fallback(question_text: str, student_answer: str) -> dict:
        """Deterministic fallback: overlap of significant words between
        question and answer. Not as accurate as the LLM check, but
        guarantees the pipeline degrades gracefully instead of failing
        open (which would risk awarding marks to off-topic answers)."""
        def significant_words(text):
            words = re.findall(r"[A-Za-z]{4,}", text.lower())
            stop = {
                "what", "which", "explain", "describe", "define", "discuss",
                "write", "with", "your", "about", "give", "list", "state",
                "briefly", "answer", "example", "examples", "diagram",
            }
            return {w for w in words if w not in stop}

        q_words = significant_words(question_text)
        a_words = significant_words(student_answer)

        if not q_words:
            return {"is_relevant": True, "relevance_score": 0.6, "reason": "Could not verify topic; giving benefit of the doubt."}

        overlap = len(q_words & a_words) / len(q_words)
        is_relevant = overlap >= 0.15
        return {
            "is_relevant": is_relevant,
            "relevance_score": round(overlap, 2),
            "reason": "Keyword-overlap fallback check (LLM check unavailable).",
        }
