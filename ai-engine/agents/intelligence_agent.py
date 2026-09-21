from sklearn.metrics.pairwise import cosine_similarity

from agents.concept_agent import _get_shared_model, _MODEL_NAME


class IntelligenceAgent:

    def __init__(self):
        print("Loading AI Model...")
        self.model = _get_shared_model(_MODEL_NAME)
        print("Model Loaded Successfully!")

    def compare_answers(self, teacher_answer, student_answer):

        teacher_embedding = self.model.encode([teacher_answer])
        student_embedding = self.model.encode([student_answer])

        similarity = cosine_similarity(
            teacher_embedding,
            student_embedding
        )[0][0]

        return similarity