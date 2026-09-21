from agents.ollama_vision_agent import OllamaVisionAgent


class EvaluationService:

    def __init__(self, model: str = "gemma3:4b"):
        self.vision_agent = OllamaVisionAgent(model=model)

    def evaluate(self, answer_key: str, student_answer: str, total_marks: float = 10.0) -> dict:
        """
        Evaluates student answer against teacher answer key.
        """
        return self.vision_agent.evaluate(
            answer_key=answer_key,
            student_answer=student_answer,
            total_marks=total_marks
        )