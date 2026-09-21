import json
import re
from pathlib import Path


class RubricAgent:

    def __init__(self):
        dataset_path = Path(__file__).parent.parent / "dataset" / "concepts.json"
        with open(dataset_path, "r", encoding="utf-8") as file:
            self.data = json.load(file)

    def _parse_advantages(self, topic, teacher_answer: str) -> list[str]:
        advantages = []
        lines = [line.strip() for line in teacher_answer.splitlines() if line.strip()]

        in_advantages_section = False
        for line in lines:
            if re.search(r"\badvantages?\b", line, re.I):
                in_advantages_section = True
                continue

            if in_advantages_section:
                if re.match(r"^(?:[-\*\•]|\d+[\.)])\s*", line):
                    text = re.sub(r"^(?:[-\*\•]|\d+[\.)])\s*", "", line).strip()
                    if text:
                        advantages.append(text)
                        continue
                if line and not re.search(r"\b(principles?|conclusion|summary|definition|definitions?)\b", line, re.I):
                    advantages.append(line)
                    continue
                if re.match(r"^[A-Z][A-Za-z\s]{0,40}:?$", line):
                    break

        if not advantages and topic in self.data:
            advantages = self.data[topic].get("advantages", [])

        return advantages

    def _parse_diagram_requirement(self, topic, teacher_answer: str) -> bool:
        if topic in self.data and self.data[topic].get("diagram", False):
            return True
        return bool(re.search(r"\bdiagram\b", teacher_answer, re.I))

    def evaluate(self, topic, found, missing, student_answer, teacher_answer="", total_marks=10.0):
        marks = {}
        found_list = found if isinstance(found, list) else []
        missing_list = missing if isinstance(missing, list) else []

        max_marks = float(total_marks) if total_marks and float(total_marks) > 0 else 10.0
        total_concepts = len(found_list) + len(missing_list)

        teacher_clean = (teacher_answer or "").strip()
        student_clean = (student_answer or "").strip()

        if total_concepts > 0:
            concept_ratio = len(found_list) / total_concepts
            base_marks = concept_ratio * max_marks

            # Small detail bonus (up to 5% of max_marks) if student answer length is sufficient
            if teacher_clean and student_clean and len(student_clean.split()) >= len(teacher_clean.split()) * 0.8:
                detail_bonus = max_marks * 0.05 if concept_ratio > 0 else 0.0
            else:
                detail_bonus = 0.0

            total_score = min(max_marks, base_marks + detail_bonus)
        else:
            if teacher_clean and student_clean:
                ratio = min(1.0, len(student_clean.split()) / max(1, len(teacher_clean.split())))
                total_score = ratio * max_marks
            else:
                total_score = max_marks if student_clean else 0.0

        final_marks = round(max(0.0, min(max_marks, total_score)), 1)
        calc_perc = round((final_marks / max_marks) * 100.0, 1)

        def get_grade(p):
            if p >= 90.0:
                return "A+"
            elif p >= 80.0:
                return "A"
            elif p >= 70.0:
                return "B+"
            elif p >= 60.0:
                return "B"
            elif p >= 50.0:
                return "C"
            elif p >= 40.0:
                return "D"
            else:
                return "F"

        grade_str = get_grade(calc_perc)

        marks["Concepts"] = final_marks
        marks["Completeness"] = final_marks
        marks["Structure"] = 1.0 if len(student_clean) > 20 else 0.0
        marks["Total"] = final_marks
        marks["Percentage"] = calc_perc
        marks["Grade"] = grade_str

        if calc_perc >= 90.0:
            marks["Remark"] = "Excellent Answer. Comprehensive and fully accurate."
        elif calc_perc >= 80.0:
            marks["Remark"] = "Very Good Answer. Solid concept coverage."
        elif calc_perc >= 70.0:
            marks["Remark"] = "Good Answer. Good understanding, minor concepts missing."
        elif calc_perc >= 60.0:
            marks["Remark"] = "Satisfactory Answer. Covers main points."
        elif calc_perc >= 50.0:
            marks["Remark"] = "Average Answer. Half of key concepts covered."
        elif calc_perc >= 40.0:
            marks["Remark"] = "Below Average. Major concept gaps."
        else:
            marks["Remark"] = "Incomplete Answer. Most key concepts missing."

        return marks
