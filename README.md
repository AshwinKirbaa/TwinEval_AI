# TwinEval AI — Intelligent Automated Student Evaluation & Analytics Platform 

## 📌 What is TwinEval AI?

**TwinEval AI** is an end-to-end, privacy-focused, AI-assisted academic evaluation and learning analytics platform. It bridges the gap between traditional pen-and-paper examinations and modern educational intelligence by providing automated, rubric-aligned grading, detailed question-by-question feedback, and personalized learning plans for students.

The platform is designed with a lightweight, multi-tier architecture:
- **Central Web & Application Backend**: High-performance Node.js / Express server running an embedded, portable SQLite database.
- **Local AI Engine**: Python microservice leveraging local LLMs (Ollama with `gemma3:4b`), OCR (PyMuPDF/PaddleOCR/OpenCV), semantic embeddings (`sentence-transformers`), and generative rubric generators to evaluate answers without sending sensitive student data to proprietary external clouds.
- **Interactive Responsive Frontend**: Clean, role-based dashboards for **Students** and **Teachers/Professors** with real-time evaluation processing, answer key generation, analytics, and PDF report downloads.

---

## 🎯 Which Problem Does It Solve?

### 1. The Burden of Manual Exam Grading
- **Problem**: Educators spend dozens of hours reviewing, grading, and manually annotating handwritten or typed student submissions. This results in slow turnaround times and educator burnout.
- **TwinEval AI Solution**: Automates OCR extraction from uploaded student answer sheets and question papers, performs semantic comparison against reference answers or AI-generated answer keys, and provides instant scoring suggestions.

### 2. Inconsistent & Subjective Evaluation
- **Problem**: Fatigue, subjective bias, and inconsistent adherence to grading rubrics often cause variations in scores across different graders or batches of papers.
- **TwinEval AI Solution**: Employs rubric-aware, criterion-based evaluation (evaluating model concepts, keyword matching, depth of explanation, and technical accuracy) ensuring fair and consistent scoring across all submissions.

### 3. Lack of Actionable Student Feedback
- **Problem**: Traditional exam feedback is often reduced to a single score or letter grade with minimal actionable guidance on where mistakes occurred or how to improve.
- **TwinEval AI Solution**: Delivers granular, question-level feedback, pinpoints missing keywords and conceptual gaps, and automatically generates custom **Personalized Learning Plans** tailored to each student's weaknesses.

### 4. Data Privacy & Cloud Dependency in Educational Institutions
- **Problem**: Schools and universities are often hesitant to send sensitive student exams and records to third-party cloud AI vendors due to cost, latency, and student privacy/compliance regulations.
- **TwinEval AI Solution**: Operates with **local AI execution** via Ollama. Exam data and evaluation workloads stay on institutional or local hardware.

---

## ⚡ Key Features

- 🧑‍🏫 **Teacher / Instructor Suite**:
  - Upload question papers (PDF, DOCX, images) and auto-split questions.
  - Automatic answer key generation with model answers, core concepts, and rubrics.
  - Review student submissions, examine AI recommendations, and adjust final scores and feedback.
  - Class-wide analytics on student performance and conceptual difficulty hotspots.
- 🎓 **Student Experience**:
  - Secure portal with email verification and role-based access.
  - Upload answer sheets and view real-time grading progress.
  - Comprehensive question-level feedback, score breakdown, and downloadable PDF evaluation reports.
  - Personalized remediation and learning roadmap.
- 🔒 **Security & Reliability**:
  - Mandatory email verification via SMTP (e.g., Gmail App Passwords).
  - JWT token-based authentication with bcrypt password hashing.
  - Sanitized file handling and robust JSON error boundaries.

---

## 🏗️ System Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                       Client Browser                        │
│             (Teacher / Student Responsive Portal)           │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / REST
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Central Node.js / Express Server            │
│  - Authentication & JWT Session Management                  │
│  - Student & Teacher Role-Based Route Handlers              │
│  - Submission & Evaluation Lifecycle Orchestration          │
│  - SQLite Database (`twineval.db`)                          │
└──────────────────────────────┬──────────────────────────────┘
                               │ Internal Microservice (HTTP :8000)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                Python AI Engine (ai_server.py)              │
│  - OCR Extraction (PyMuPDF, OpenCV, Image Processing)       │
│  - Semantic Matching (Sentence-Transformers & Embeddings)   │
│  - Local LLM Evaluation (Ollama / gemma3:4b)                │
│  - PDF Report Generation (ReportLab)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites

Before running the application, ensure you have installed:

1. **Node.js**: `v22.5.0` or higher
2. **Python**: `3.10` to `3.12`
3. **Ollama**: Installed and running ([ollama.com](https://ollama.com/))
   - Pull the default evaluation model:
     ```bash
     ollama pull gemma3:4b
     ```

---

## ⚙️ Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/AshwinKirbaa/TwinEval_AI.git
cd TwinEval_AI
```

### 2. Configure Environment Variables
Copy the example environment file and create your `.env`:
```bash
cp .env.example .env
```

Open `.env` and configure your settings:
```env
# Application Host & Port
HOST=0.0.0.0
PORT=5000
NODE_ENV=development

# Database path (SQLite portable file)
DB_PATH=./database/twineval.db

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# Email Verification (SMTP)
PUBLIC_APP_URL=http://localhost:5000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-character-app-password
SMTP_FROM=TwinEval AI <your-email@gmail.com>

# AI Engine Service
AI_SERVICE_HOST=127.0.0.1
AI_SERVICE_PORT=8000
AI_ENGINE_MODEL=gemma3:4b
```

> **Note on Email Verification**: TwinEval AI requires newly registered users to verify their email. If using Gmail, generate an **App Password** under Google Account Security and configure `SMTP_USER` and `SMTP_PASS`.

---

## 🚀 How to Run the Project

TwinEval AI runs in two coordinated components: the **Central Web Server** and the **Local AI Engine**.

### Quick Start (One-Click Scripts)

#### On Windows:
1. **Start the AI Engine** (Terminal 1):
   Double-click `start-ai-windows.bat` or run:
   ```cmd
   .\start-ai-windows.bat
   ```
2. **Start the Web & API Server** (Terminal 2):
   Double-click `start-windows.bat` or run:
   ```cmd
   .\start-windows.bat
   ```

#### On macOS / Linux:
1. **Start the AI Engine** (Terminal 1):
   ```bash
   chmod +x start-ai-macos.sh
   ./start-ai-macos.sh
   ```
2. **Start the Web & API Server** (Terminal 2):
   ```bash
   chmod +x start-macos.sh
   ./start-macos.sh
   ```

---

### Manual Step-by-Step Setup

If you prefer starting each service manually from the terminal:

#### Step A: Run the Python AI Engine
```bash
# 1. Create and activate Python virtual environment
python -m venv .venv

# Windows activation:
.venv\Scripts\activate
# macOS/Linux activation:
source .venv/bin/activate

# 2. Install dependencies
pip install -r ai-engine/requirements.txt

# 3. Verify Ollama is running and model is present
ollama list

# 4. Start the AI microservice (runs on port 8000)
python ai-engine/ai_server.py
```

#### Step B: Run the Node.js Server
```bash
# 1. Install Node.js dependencies
npm install

# 2. Initialize the SQLite database and seed sample data
npm run setup

# 3. Launch the server (runs on port 5000)
npm start
# Or for development with live reload:
npm run dev
```

---

## 🌐 Accessing the Application

- **Local Machine Access**: Open your web browser and go to:
  ```text
  http://localhost:5000
  ```
- **Local Network (LAN) Access**:
  When running on `HOST=0.0.0.0`, other machines (laptops, tablets) on the same Wi-Fi/LAN can access the server using your local IP:
  ```text
  http://<YOUR_LOCAL_IP>:5000
  ```
  *(Example: `http://192.168.1.10:5000`)*

---

## 🧪 Testing Credentials (Default Seed Data)

If you ran `npm run setup`, the database includes pre-configured sample accounts:

| Role | Email | Password |
|---|---|---|
| **Teacher** | `sarah.jenkins@twineval.edu` | `password123` |
| **Student** | `alex.chen@student.twineval.edu` | `password123` |

---

## 📁 Project Structure

```text
TWINEVAL-fixed/
├── ai-engine/               # Python AI & OCR Microservice
│   ├── agents/              # Multi-agent evaluators & generators
│   ├── models/              # Evaluation data models
│   ├── services/            # Paper evaluation core service
│   ├── utils/               # PDF readers, OCR processors, report generators
│   ├── ai_server.py         # Flask REST API bridge for the AI service
│   └── requirements.txt     # Python package requirements
├── database/                # SQLite database directory (`twineval.db`)
├── docs/                    # API Documentation & Network Guides
├── public/                  # Frontend Web Interface
│   ├── css/                 # Stylesheets
│   ├── js/                  # Client-side scripts and API callers
│   ├── teacher-*.html       # Teacher portal pages
│   ├── student-*.html       # Student portal pages
│   └── index.html           # Landing & authentication portal
├── scripts/                 # Database initialization & migration scripts
├── src/                     # Node.js / Express Backend
│   ├── config/              # Database connection & environment configuration
│   ├── controllers/         # Business logic & request controllers
│   ├── middleware/          # Authentication & error handling
│   ├── routes/              # Express API route endpoints
│   └── services/            # Email (SMTP), AI dispatch, and DB services
├── server.js                # Main Express server entry point
├── start-windows.bat        # Windows 1-click startup for central server
├── start-ai-windows.bat     # Windows 1-click startup for local AI engine
├── package.json             # Node dependencies and project scripts
└── README.md                # Project documentation
```

---

## 📄 Documentation & References

- [Complete API Documentation](file:///d:/Projects/TWINEVAL-fixed%203/TWINEVAL-fixed/docs/API_DOCUMENTATION.md)
- [Multi-System LAN Setup Guide](file:///d:/Projects/TWINEVAL-fixed%203/TWINEVAL-fixed/docs/NETWORK_ACCESS.md)

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

## Authentication

TwinEval AI signs users in with **email + password**. A successful login sets an **HttpOnly, SameSite=Lax session cookie** (`twineval_session`; `Secure` when `NODE_ENV=production`), so the browser's JavaScript never holds the credential. The server re-reads the user's role from the database on every request; the role in the token or sent by the browser is never trusted. `Authorization: Bearer <token>` is still accepted for API clients (the login response still includes `token`).

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/register` | Create a student or teacher account (admin accounts cannot be self-registered) and email a verification link |
| `POST /auth/login` | `{ email, password, remember }` - sets the session cookie. `remember=true` keeps it for `JWT_EXPIRES_IN` (7d); otherwise it ends with the browser session (12h max) |
| `POST /auth/logout` | Clears the session cookie |
| `GET /auth/me` | Current user (used to restore the session on page load) |
| `POST /auth/forgot-password` | `{ email }` - always answers the same way; emails a 1-hour, single-use link if the account exists |
| `POST /auth/reset-password` | `{ token, password }` - sets a new password and signs out all older sessions |

**Required configuration** (see `.env.example`): `JWT_SECRET` (mandatory in production, 32+ characters) and SMTP settings (`SMTP_USER`, `SMTP_PASS`, plus `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM` for non-Gmail providers, and `PUBLIC_APP_URL` so links in emails point to your real address). If SMTP is not configured, sign-up and "Forgot password" respond with an explicit error; nothing pretends to send mail. Sign-in, rate limits (login 10 / 15 min, forgot-password 5 / 15 min, register 10 / hour per IP) and CSRF protection (custom header + same-origin check for cookie-authenticated writes) need no extra setup.

To create an admin account, insert/update the row directly (`UPDATE Users SET role = 'admin' WHERE email = '...'`).

**Run locally**

```bash
npm install
cp .env.example .env      # then fill in SMTP settings; JWT_SECRET is optional in development
npm start                 # http://localhost:5000
npm test                  # unit + integration tests (Node 22.5+, no extra tooling)
```
