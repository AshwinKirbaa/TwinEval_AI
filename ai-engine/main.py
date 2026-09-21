import sys
import time

# Ensure UTF-8 stdout on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from agents.intelligence_agent import IntelligenceAgent
from agents.concept_agent import ConceptAgent
from agents.rubric_agent import RubricAgent
from agents.fairness_agent import FairnessAgent
from agents.report_agent import ReportAgent
from agents.bloom_agent import BloomAgent
from agents.feedback_agent import FeedbackAgent

# -------------------------------------------------
# Topic
# -------------------------------------------------
topic = "OSI Model"

teacher_answer = """
The OSI model consists of seven layers:
Physical Layer,
Data Link Layer,
Network Layer,
Transport Layer,
Session Layer,
Presentation Layer,
Application Layer.

Advantages:
Standardization
Easy Troubleshooting
"""

student_answer = """
The OSI model consists of seven layers:

Physical Layer transfers bits.
Data Link Layer handles framing.
Network Layer performs routing.
Transport Layer ensures reliable communication.
Session Layer manages sessions.
Presentation Layer handles encryption and translation.
Application Layer provides services to users.

Advantages:
Standardization
Interoperability
Easy Troubleshooting

In conclusion, the OSI model provides a standard framework for network communication.

Diagram
"""

# -------------------------------------------------
# Initialize Agents
# -------------------------------------------------
intelligence = IntelligenceAgent()
concept = ConceptAgent()
rubric = RubricAgent()
fairness = FairnessAgent()
report = ReportAgent()
bloom = BloomAgent()
feedback = FeedbackAgent()

# -------------------------------------------------
# Start Timer
# -------------------------------------------------
start = time.perf_counter()

# -------------------------------------------------
# Intelligence Agent
# -------------------------------------------------
similarity = intelligence.compare_answers(
    teacher_answer,
    student_answer
)

# -------------------------------------------------
# Concept Agent
# -------------------------------------------------
found, missing = concept.check_concepts(
    topic,
    student_answer
)

# -------------------------------------------------
# Rubric Agent
# -------------------------------------------------
marks = rubric.evaluate(
    topic,
    found,
    missing,
    student_answer
)
# -------------------------------------------------
# Fairness Agent
# -------------------------------------------------
confidence = fairness.verify(similarity)

# -------------------------------------------------
# Bloom Agent
# -------------------------------------------------
bloom_result = bloom.analyze(student_answer)

print("\n========== BLOOM ANALYSIS ==========")
print(f"Bloom Level : {bloom_result['level']}")
print(f"Confidence  : {bloom_result['confidence']}%")

print("\nMatched Keywords")
print("----------------")

if bloom_result["matched"]:
    for word in bloom_result["matched"]:
        print(f"[+] {word}")
else:
    print("None")

print("\nReason")
print("------")
print(bloom_result["reason"])

# -------------------------------------------------
# Feedback Agent
# -------------------------------------------------
feedback_result = feedback.generate_feedback(
    marks,
    bloom_result
)

print("\n========== FEEDBACK ==========")

print("\nStrengths")
print("----------")
if feedback_result["strengths"]:
    for item in feedback_result["strengths"]:
        print(f"[+] {item}")
else:
    print("None")

print("\nAreas to Improve")
print("----------------")
if feedback_result["improvements"]:
    for item in feedback_result["improvements"]:
        print(f"[*] {item}")
else:
    print("None")

print("\nSuggestions")
print("-----------")
if feedback_result["suggestions"]:
    for item in feedback_result["suggestions"]:
        print(f"[*] {item}")
else:
    print("None")

# -------------------------------------------------
# Report Agent
# -------------------------------------------------
report.generate(
    marks,
    found,
    missing,
    confidence
)

# -------------------------------------------------
# Stop Timer
# -------------------------------------------------
end = time.perf_counter()

print(f"\nEvaluation Time : {end - start:.3f} seconds")