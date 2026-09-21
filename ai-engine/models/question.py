"""
Data models for the multi-question paper workflow.

These are additive to the existing Student/Teacher models and do not
change any existing API -- old single-answer flows keep working.
"""
from dataclasses import dataclass, field
from typing import List, Optional
import uuid


@dataclass
class Question:
    """A single exam question, either typed manually or extracted from
    an uploaded question paper (PDF/image).

    group_id / group_required describe an "answer any N of these
    questions" or "(OR)" relationship with sibling questions that share
    the same group_id -- e.g. Part C's "Answer any two questions"
    (group_required=2 across 3 questions), or a "19.a) ... (OR) 19.b)
    ..." pair (group_required=1 across 2 questions). group_id is None
    for a question that must simply be answered on its own (no
    alternative/choice involved).
    """

    text: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    topic: str = ""
    max_marks: float = 10.0
    source: str = "manual"  # "manual" | "upload"
    group_id: Optional[str] = None
    group_required: Optional[int] = None

    def to_dict(self):
        return {
            "id": self.id,
            "text": self.text,
            "topic": self.topic,
            "max_marks": self.max_marks,
            "source": self.source,
            "group_id": self.group_id,
            "group_required": self.group_required,
        }

    @staticmethod
    def from_dict(d: dict) -> "Question":
        return Question(
            id=d.get("id") or uuid.uuid4().hex[:8],
            text=d.get("text", ""),
            topic=d.get("topic", ""),
            max_marks=float(d.get("max_marks", 10.0)),
            source=d.get("source", "manual"),
            group_id=d.get("group_id"),
            group_required=d.get("group_required"),
        )


@dataclass
class AnswerKey:
    """AI-generated model answer key for a single Question."""

    question_id: str
    model_answer: str = ""
    keywords: List[str] = field(default_factory=list)
    concepts: List[str] = field(default_factory=list)
    expected_points: List[str] = field(default_factory=list)
    advantages: List[str] = field(default_factory=list)
    disadvantages: List[str] = field(default_factory=list)
    applications: List[str] = field(default_factory=list)
    steps: List[str] = field(default_factory=list)
    formulae: List[str] = field(default_factory=list)
    diagrams: List[str] = field(default_factory=list)
    bloom_level: str = "Understand"
    rubric: dict = field(default_factory=dict)  # criterion -> max marks for this question

    def to_dict(self):
        return {
            "question_id": self.question_id,
            "model_answer": self.model_answer,
            "keywords": self.keywords,
            "concepts": self.concepts,
            "expected_points": self.expected_points,
            "advantages": self.advantages,
            "disadvantages": self.disadvantages,
            "applications": self.applications,
            "steps": self.steps,
            "formulae": self.formulae,
            "diagrams": self.diagrams,
            "bloom_level": self.bloom_level,
            "rubric": self.rubric,
        }

    @staticmethod
    def from_dict(d: dict) -> "AnswerKey":
        return AnswerKey(
            question_id=d.get("question_id", ""),
            model_answer=d.get("model_answer", ""),
            keywords=d.get("keywords", []) or [],
            concepts=d.get("concepts", []) or [],
            expected_points=d.get("expected_points", []) or [],
            advantages=d.get("advantages", []) or [],
            disadvantages=d.get("disadvantages", []) or [],
            applications=d.get("applications", []) or [],
            steps=d.get("steps", []) or [],
            formulae=d.get("formulae", []) or [],
            diagrams=d.get("diagrams", []) or [],
            bloom_level=d.get("bloom_level", "Understand"),
            rubric=d.get("rubric", {}) or {},
        )
