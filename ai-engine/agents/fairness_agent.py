class FairnessAgent:

    def verify(self, similarity):

        if similarity >= 0.90:
            confidence = 98

        elif similarity >= 0.80:
            confidence = 94

        elif similarity >= 0.70:
            confidence = 90

        elif similarity >= 0.60:
            confidence = 82

        else:
            confidence = 70

        return confidence