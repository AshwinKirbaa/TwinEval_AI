import json
from pathlib import Path


class BloomAgent:

    def __init__(self):
        dataset_path = Path(__file__).parent.parent / "dataset" / "bloom_levels.json"
        with open(dataset_path, "r", encoding="utf-8") as file:
            self.levels = json.load(file)

    def analyze(self, student_answer):

        answer = student_answer.lower()

        scores = {}
        matched_keywords = {}

        # Count keyword matches for each Bloom level
        for level, keywords in self.levels.items():

            matched = []

            for keyword in keywords:
                if keyword.lower() in answer:
                    matched.append(keyword)

            scores[level] = len(matched)
            matched_keywords[level] = matched

        # Find the best Bloom level
        best_level = max(scores, key=scores.get) if scores else "Remember"
        best_score = scores.get(best_level, 0)

        total_matches = sum(scores.values())

        if total_matches == 0:
            confidence = 0
        else:
            confidence = round((best_score / total_matches) * 100, 2)

        # Generate explanation
        reasons = {
            "Remember": "The answer mainly recalls facts or lists information.",
            "Understand": "The answer explains concepts and demonstrates understanding.",
            "Apply": "The answer applies concepts to solve a problem.",
            "Analyze": "The answer compares or examines relationships.",
            "Evaluate": "The answer justifies or critiques ideas.",
            "Create": "The answer proposes or designs something new."
        }

        return {
            "level": best_level,
            "confidence": confidence,
            "scores": scores,
            "matched": matched_keywords.get(best_level, []),
            "reason": reasons.get(best_level, "Analysis complete.")
        }