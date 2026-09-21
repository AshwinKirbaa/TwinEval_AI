import json
import re
import os

from utils import ollama_client

from agents.concept_agent import ConceptAgent
from agents.feedback_agent import FeedbackAgent
from agents.bloom_agent import BloomAgent
from agents.rubric_agent import RubricAgent


def calculate_grade(percentage: float) -> str:
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
    else:
        return "F"


class OllamaVisionAgent:

    def __init__(self, model: str = "gemma3:4b"):
        self.model = model

    # -------------------------------------------------------
    # OCR Pipeline
    # -------------------------------------------------------

    def extract_text(self, image_path: str) -> str:
        """
        Extract handwritten and printed text from an answer sheet image.
        Preserves line breaks, punctuation, and exact text without summarizing.
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image path not found: {image_path}")

        prompt = """You are a strict OCR transcription engine. You are NOT an assistant, translator, or programmer -- you only copy down exactly what is visibly written in this image, character by character.

Absolute rules -- breaking any of these is a failure:
1. Transcribe the text EXACTLY as it appears. Copy it, do not compose it.
2. Preserve original line breaks, indentation, spacing, and punctuation.
3. Do NOT translate any word or phrase into any other language, for any reason. Output must stay in the same language/script as the source. Never append a translation, gloss, or meaning next to a word.
4. Do NOT summarize, shorten, paraphrase, or reword anything.
5. Do NOT correct spelling, grammar, or punctuation, even if it looks wrong.
6. If this image contains source code: transcribe it literally, exactly as handwritten/printed, even if the syntax looks broken, incomplete, or non-standard. Do NOT "fix" it, do NOT complete it from memory of what similar code usually looks like, and do NOT substitute a cleaner/more typical version of the code. Copy the exact characters, exact variable names, exact method calls -- even apparent typos.
7. Do NOT add any commentary, explanation, translation, annotation, header, or note of any kind -- not in brackets, not after a dash, not in parentheses. Only the transcribed text itself.
8. If a specific word or character is genuinely illegible, write [unclear] in its place instead of guessing a plausible replacement.
9. Do NOT add anything that is not visibly present in the image.
10. Return ONLY the raw transcribed text. No preamble, no sign-off, nothing else.
"""

        options = {
            # Deterministic, literal transcription -- no creative sampling.
            "temperature": 0,
            "top_p": 0.1,
            "top_k": 1,
            "repeat_penalty": 1.0,
        }

        try:
            response = ollama_client.chat(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                        "images": [image_path]
                    }
                ],
                options=options,
                # Vision/OCR calls are slower than plain text chat --
                # give them more headroom before treating it as stuck.
                timeout=float(os.environ.get("OLLAMA_OCR_TIMEOUT_SECONDS", "180")),
            )
            return response["message"]["content"].strip()
        except Exception as e:
            err_msg = str(e).lower()
            if "not found" in err_msg or "404" in err_msg:
                print(f"Model '{self.model}' not found. Attempting automatic pull...")
                try:
                    ollama_client.pull(self.model)
                    response = ollama_client.chat(
                        model=self.model,
                        messages=[
                            {
                                "role": "user",
                                "content": prompt,
                                "images": [image_path]
                            }
                        ],
                        options=options,
                        timeout=float(os.environ.get("OLLAMA_OCR_TIMEOUT_SECONDS", "180")),
                    )
                    return response["message"]["content"].strip()
                except Exception as pull_err:
                    raise RuntimeError(f"Model '{self.model}' is currently downloading or missing: {pull_err}")
            print(f"Ollama OCR Error: {e}")
            raise RuntimeError(f"OCR extraction failed: {e}")

    # -------------------------------------------------------
    # Evaluation Pipeline
    # -------------------------------------------------------

    def evaluate(
        self,
        answer_key: str,
        student_answer: str,
        total_marks: float = 10.0,
        topic: str = None,
        **kwargs,
    ) -> dict:
        """
        Evaluates student answer against teacher answer key using local Ollama model.
        Guarantees strict evaluation schema and criteria.
        """
        clean_teacher = (answer_key or "").strip()
        clean_student = (student_answer or "").strip()

        # Handle empty student answer
        if not clean_student:
            teacher_lines = ConceptAgent().extract_concepts_from_teacher(clean_teacher)
            if not teacher_lines:
                teacher_lines = [line.strip() for line in clean_teacher.splitlines() if line.strip()]
            return {
                "student_answer": "",
                "is_identical": False,
                "marks": 0.0,
                "percentage": 0.0,
                "grade": "F",
                "found_concepts": [],
                "missing_concepts": teacher_lines if teacher_lines else ["Key Concepts"],
                "strengths": [],
                "improvements": ["Please provide a complete answer."],
                "suggestions": ["Answer the question based on the study material."],
                "bloom_level": "Remember",
                "confidence": 100.0,
                "feedback": "No student answer was provided."
            }

        # Normalize for identical comparison
        norm_teacher = re.sub(r"\s+", " ", clean_teacher.lower()).strip()
        norm_student = re.sub(r"\s+", " ", clean_student.lower()).strip()

        if norm_teacher == norm_student:
            teacher_lines = ConceptAgent().extract_concepts_from_teacher(clean_teacher)
            if not teacher_lines:
                teacher_lines = [line.strip() for line in clean_teacher.splitlines() if line.strip()]
            return {
                "student_answer": clean_student,
                "is_identical": True,
                "marks": float(total_marks),
                "percentage": 100.0,
                "grade": "A+",
                "found_concepts": teacher_lines if teacher_lines else [clean_teacher],
                "missing_concepts": [],
                "strengths": ["Identical match to model teacher answer.", "Completely accurate and thorough."],
                "improvements": [],
                "suggestions": ["Maintain this level of precision and clarity."],
                "bloom_level": "Understand",
                "confidence": 100.0,
                "feedback": "Student answer is identical to the teacher model answer. Full marks awarded."
            }

        # Non-identical answer pipeline
        eval_topic = topic or "General Evaluation"

        # 1. Concept Analysis
        concept_agent = ConceptAgent()
        found, missing = concept_agent.check_concepts(
            eval_topic,
            clean_student,
            teacher_answer=clean_teacher
        )

        # 2. Rubric Evaluation
        rubric_agent = RubricAgent()
        rubric_result = rubric_agent.evaluate(
            eval_topic,
            found,
            missing,
            clean_student,
            teacher_answer=clean_teacher,
            total_marks=total_marks
        )

        # 3. Bloom Taxonomy Analysis
        bloom_agent = BloomAgent()
        bloom_result = bloom_agent.analyze(clean_student)

        # 4. Feedback Generation
        feedback_agent = FeedbackAgent()
        feedback_result = feedback_agent.generate_feedback(
            rubric_result,
            bloom_result,
            found_concepts=found,
            missing_concepts=missing
        )

        # Assemble unified result
        calculated_marks = round(float(rubric_result.get("Total", 0.0)), 2)
        max_marks_val = float(total_marks) if total_marks and float(total_marks) > 0 else 10.0
        calc_percentage = round((calculated_marks / max_marks_val) * 100.0, 2)
        grade_val = calculate_grade(calc_percentage)

        feedback_lines = []
        if rubric_result.get("Remark"):
            feedback_lines.append(rubric_result["Remark"])
        if found:
            feedback_lines.append(f"Identified concept(s): {', '.join(found[:4])}.")
        if missing:
            feedback_lines.append(f"Missing concept(s): {', '.join(missing[:4])}.")
        if bloom_result.get("reason"):
            feedback_lines.append(bloom_result["reason"])

        summary_feedback = " ".join([line.strip() for line in feedback_lines if line.strip()])

        result = {
            "student_answer": clean_student,
            "is_identical": False,
            "marks": calculated_marks,
            "percentage": calc_percentage,
            "grade": grade_val,
            "found_concepts": found,
            "missing_concepts": missing,
            "rubric": rubric_result,
            "strengths": feedback_result.get("strengths", []),
            "improvements": feedback_result.get("improvements", []),
            "suggestions": feedback_result.get("suggestions", []),
            "bloom_level": bloom_result.get("level", "Understand"),
            "confidence": bloom_result.get("confidence", 85.0),
            "feedback": summary_feedback
        }

        return result