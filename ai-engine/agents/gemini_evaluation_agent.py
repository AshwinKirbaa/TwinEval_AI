from google import genai
import json
import os
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


class GeminiEvaluationAgent:

    def evaluate(self, teacher_answer, student_answer):

        prompt = f"""
You are an experienced university examiner.

Compare the teacher's answer with the student's answer.

Teacher Answer:
{teacher_answer}

Student Answer:
{student_answer}

Evaluate the student's answer fairly.

Award marks out of 10.

Return ONLY valid JSON in this format:

{{
  "marks": 8,
  "grade": "A",
  "percentage": 80,
  "found_concepts": [],
  "missing_concepts": [],
  "strengths": [],
  "improvements": [],
  "suggestions": [],
  "bloom_level": "Understand",
  "confidence": 95,
  "feedback": "Overall evaluation of the student's answer."
}}
"""

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt
        )

        text = response.text.strip()

        # Remove Markdown code fences
        if text.startswith("```"):
            text = text.replace("```json", "").replace("```", "").strip()

        try:
            return json.loads(text)

        except json.JSONDecodeError:
            raise ValueError(
                f"Gemini returned invalid JSON:\n\n{text}"
            )