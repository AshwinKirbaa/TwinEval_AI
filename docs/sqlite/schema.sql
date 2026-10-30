-- TwinEval AI - SQLite schema
-- This file is applied automatically on server startup.

CREATE TABLE IF NOT EXISTS Users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('admin', 'teacher', 'student')),
    avatar_url TEXT,
    college TEXT,
    department TEXT,
    year TEXT,
    email_verified_at TEXT,
    verification_token_hash TEXT,
    verification_expires_at TEXT,
    google_subject TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_email ON Users(email);
CREATE INDEX IF NOT EXISTS idx_user_role ON Users(role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_subject ON Users(google_subject);

CREATE TABLE IF NOT EXISTS Student (
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    roll_no TEXT,
    user_id INTEGER,
    email TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_student_dept ON Student(department);
CREATE INDEX IF NOT EXISTS idx_student_semester ON Student(semester);
CREATE INDEX IF NOT EXISTS idx_student_email ON Student(email);
CREATE INDEX IF NOT EXISTS idx_student_roll_no ON Student(roll_no);

CREATE TABLE IF NOT EXISTS EvaluationResult (
    evaluation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    marks REAL NOT NULL CHECK (marks BETWEEN 0 AND 100),
    attendance REAL NOT NULL CHECK (attendance BETWEEN 0 AND 100),
    communication REAL NOT NULL CHECK (communication BETWEEN 0 AND 100),
    problem_solving REAL NOT NULL CHECK (problem_solving BETWEEN 0 AND 100),
    ai_score REAL NOT NULL CHECK (ai_score BETWEEN 0 AND 100),
    remarks TEXT,
    evaluated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_student ON EvaluationResult(student_id);
CREATE INDEX IF NOT EXISTS idx_eval_subject ON EvaluationResult(subject);
CREATE INDEX IF NOT EXISTS idx_eval_ai_score ON EvaluationResult(ai_score);

CREATE TABLE IF NOT EXISTS LearningPlan (
    plan_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    weak_topics TEXT NOT NULL,
    recommended_resources TEXT NOT NULL,
    practice_tasks TEXT NOT NULL,
    study_schedule TEXT,
    generated_date TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_student ON LearningPlan(student_id);

CREATE TABLE IF NOT EXISTS TeacherAnalytics (
    analytics_id INTEGER PRIMARY KEY AUTOINCREMENT,
    department TEXT NOT NULL,
    average_score REAL NOT NULL,
    top_students TEXT,
    weak_students TEXT,
    generated_on TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_dept ON TeacherAnalytics(department);

CREATE TABLE IF NOT EXISTS QuestionPaper (
    paper_id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    topic TEXT,
    pass_percentage REAL NOT NULL DEFAULT 40.00,
    source_file_path TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paper_teacher ON QuestionPaper(teacher_id);
CREATE INDEX IF NOT EXISTS idx_paper_status ON QuestionPaper(status);

CREATE TABLE IF NOT EXISTS Question (
    question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    ai_question_id TEXT NOT NULL,
    question_order INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    topic TEXT,
    max_marks REAL NOT NULL DEFAULT 10.00,
    group_id TEXT,
    group_required INTEGER,
    FOREIGN KEY (paper_id) REFERENCES QuestionPaper(paper_id) ON DELETE CASCADE,
    UNIQUE (paper_id, ai_question_id)
);

CREATE INDEX IF NOT EXISTS idx_question_paper ON Question(paper_id);
CREATE INDEX IF NOT EXISTS idx_question_ai_id ON Question(paper_id, ai_question_id);

CREATE TABLE IF NOT EXISTS AnswerKey (
    answer_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES Question(question_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Submission (
    submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    answer_file_path TEXT,
    raw_extracted_text TEXT,
    total_marks REAL,
    max_marks REAL,
    percentage REAL,
    grade TEXT,
    pass_fail TEXT CHECK (pass_fail IN ('Pass', 'Fail') OR pass_fail IS NULL),
    overall_report TEXT,
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'evaluated', 'reviewed', 'failed')),
    error_message TEXT,
    teacher_override_marks REAL,
    teacher_comments TEXT,
    submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    evaluated_at TEXT,
    FOREIGN KEY (paper_id) REFERENCES QuestionPaper(paper_id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES Student(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_paper ON Submission(paper_id);
CREATE INDEX IF NOT EXISTS idx_submission_student ON Submission(student_id);
CREATE INDEX IF NOT EXISTS idx_submission_status ON Submission(status);

CREATE TABLE IF NOT EXISTS QuestionResult (
    result_id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    student_answer TEXT,
    marks REAL NOT NULL DEFAULT 0,
    max_marks REAL NOT NULL,
    percentage REAL,
    grade TEXT,
    is_off_topic INTEGER DEFAULT 0,
    needs_review INTEGER DEFAULT 0,
    teacher_override_marks REAL,
    full_result TEXT NOT NULL,
    FOREIGN KEY (submission_id) REFERENCES Submission(submission_id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES Question(question_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qresult_submission ON QuestionResult(submission_id);

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON Users
FOR EACH ROW
BEGIN
    UPDATE Users SET updated_at = CURRENT_TIMESTAMP WHERE user_id = OLD.user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_student_updated_at
AFTER UPDATE ON Student
FOR EACH ROW
BEGIN
    UPDATE Student SET updated_at = CURRENT_TIMESTAMP WHERE student_id = OLD.student_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_question_paper_updated_at
AFTER UPDATE ON QuestionPaper
FOR EACH ROW
BEGIN
    UPDATE QuestionPaper SET updated_at = CURRENT_TIMESTAMP WHERE paper_id = OLD.paper_id;
END;
