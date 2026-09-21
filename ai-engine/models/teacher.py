from dataclasses import dataclass


@dataclass
class Teacher:
    name: str
    subject: str
    max_marks: int

    def to_dict(self):
        return {
            "name": self.name,
            "subject": self.subject,
            "max_marks": self.max_marks
        }