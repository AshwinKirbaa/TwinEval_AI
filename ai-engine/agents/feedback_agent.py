class FeedbackAgent:

    def generate_feedback(self, rubric_result, bloom_result, found_concepts=None, missing_concepts=None):
        strengths = []
        improvements = []
        suggestions = []

        found = found_concepts if isinstance(found_concepts, list) else []
        missing = missing_concepts if isinstance(missing_concepts, list) else []

        if found:
            strengths.append(f"Correctly identified key concept(s): {', '.join(found[:5])}.")
        elif rubric_result.get("Concepts", 0) > 0:
            strengths.append("Demonstrated foundational understanding of core concepts.")

        if rubric_result.get("Completeness", 0) >= 2.5:
            strengths.append("Answer is thorough and well-detailed relative to the model answer key.")
        elif rubric_result.get("Completeness", 0) >= 1.5:
            strengths.append("Provided a good basic explanation of the topic.")

        if rubric_result.get("Structure", 0) >= 0.8:
            strengths.append("Clear structure and formatting presented.")

        # Areas to Improve
        if missing:
            for item in missing:
                improvements.append(f"Include missing concept: {item}")
        elif rubric_result.get("Concepts", 0) < 4.0:
            improvements.append("Expand on key concepts and definitions from the study material.")

        if rubric_result.get("Completeness", 0) < 2.0:
            improvements.append("Elaborate further to cover all parts of the teacher's model answer key.")

        if not improvements:
            improvements.append("No critical areas to improve noted. Maintain this quality.")

        # Suggestions based on missing concepts and Bloom level
        if missing:
            suggestions.append(f"Study and review the missing concepts: {', '.join(missing[:4])}.")

        bloom = bloom_result.get("level", "Understand") if isinstance(bloom_result, dict) else "Understand"

        if bloom == "Remember":
            suggestions.append("Explain the concepts in your own words rather than solely listing facts.")
        elif bloom == "Understand":
            suggestions.append("Include real-world applications or examples to strengthen your explanation.")
        elif bloom == "Apply":
            suggestions.append("Demonstrate practical implementation details in your answer.")
        elif bloom == "Analyze":
            suggestions.append("Compare and contrast related concepts for deeper analysis.")
        elif bloom == "Evaluate":
            suggestions.append("Provide clear justifications and trade-offs for your points.")
        elif bloom == "Create":
            suggestions.append("Excellent higher-order synthesis and problem-solving shown.")

        return {
            "strengths": strengths,
            "improvements": improvements,
            "suggestions": suggestions
        }
