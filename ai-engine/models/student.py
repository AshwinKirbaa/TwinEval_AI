from dataclasses import dataclass
from datetime import datetime


@dataclass
class Student:
    name: str
    register_no: str
    department: str
    semester: str
    subject: str

    def to_dict(self):
        return {
            "name": self.name,
            "register_no": self.register_no,
            "department": self.department,
            "semester": self.semester,
            "subject": self.subject
        }