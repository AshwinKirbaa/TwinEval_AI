from pathlib import Path
from datetime import date
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, Image, KeepTogether, HRFlowable, Preformatted,
    NextPageTemplate
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
import os
import re


ROOT = Path(r"D:\Projects\TWINEVAL-fixed 3\TWINEVAL-fixed")
OUT = ROOT / "output" / "pdf" / "TwinEval_AI_Current_Project_Report.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

SCREENSHOTS = [
    (Path(r"C:\Users\ashwi\AppData\Local\Temp\codex-clipboard-cb5519af-0ca0-4784-920c-9257e4b31b92.png"), "Student dashboard with live evaluation summary and recent activity."),
    (Path(r"C:\Users\ashwi\AppData\Local\Temp\codex-clipboard-181d4d29-0a1b-4834-ac20-12b4266da74b.png"), "Student answer-sheet upload workflow and local AI evaluation entry point."),
    (Path(r"C:\Users\ashwi\AppData\Local\Temp\codex-clipboard-55d76110-79ad-41c8-994f-ebe455575260.png"), "Question-wise AI feedback with teacher-reviewed marks and comments."),
]

NAVY = colors.HexColor("#292B3D")
PURPLE = colors.HexColor("#6957C8")
CORAL = colors.HexColor("#FF7054")
PALE = colors.HexColor("#F4F5F9")
MINT = colors.HexColor("#E7F7EF")
GREEN = colors.HexColor("#2FA66D")
AMBER = colors.HexColor("#E99A22")
GREY = colors.HexColor("#6F7280")
LIGHT_GREY = colors.HexColor("#E6E7EC")
WHITE = colors.white


def esc(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=30, leading=34, textColor=NAVY, alignment=TA_CENTER, spaceAfter=12
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=14, leading=20, textColor=PURPLE, alignment=TA_CENTER, spaceAfter=8
))
styles.add(ParagraphStyle(
    name="H1X", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=20, leading=24, textColor=NAVY, spaceBefore=6, spaceAfter=12, keepWithNext=True
))
styles.add(ParagraphStyle(
    name="H2X", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=14, leading=18, textColor=PURPLE, spaceBefore=12, spaceAfter=7, keepWithNext=True
))
styles.add(ParagraphStyle(
    name="H3X", parent=styles["Heading3"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=9, spaceAfter=5, keepWithNext=True
))
styles.add(ParagraphStyle(
    name="BodyX", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.5, leading=14, textColor=NAVY, alignment=TA_LEFT, spaceAfter=7
))
styles.add(ParagraphStyle(
    name="SmallX", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.8, leading=10.5, textColor=GREY, spaceAfter=4
))
styles.add(ParagraphStyle(
    name="BulletX", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.2, leading=13.2, textColor=NAVY, leftIndent=12, firstLineIndent=-7,
    bulletIndent=2, spaceAfter=4
))
styles.add(ParagraphStyle(
    name="CaptionX", parent=styles["BodyText"], fontName="Helvetica-Oblique",
    fontSize=8, leading=10, textColor=GREY, alignment=TA_CENTER, spaceBefore=4, spaceAfter=10
))
styles.add(ParagraphStyle(
    name="CalloutX", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=13, textColor=NAVY, leftIndent=10, rightIndent=10, spaceBefore=5, spaceAfter=5
))
styles.add(ParagraphStyle(
    name="CodeX", parent=styles["Code"], fontName="Courier", fontSize=7.4,
    leading=9.5, textColor=colors.HexColor("#242534"), leftIndent=8, rightIndent=8,
    borderColor=LIGHT_GREY, borderWidth=0.5, borderPadding=7, backColor=colors.HexColor("#F8F8FA"),
    spaceBefore=4, spaceAfter=8
))
styles.add(ParagraphStyle(
    name="TOCHeading", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=22, leading=26, textColor=NAVY, spaceAfter=16
))


class ReportDocTemplate(BaseDocTemplate):
    def __init__(self, filename, **kw):
        super().__init__(filename, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates(PageTemplate(id="main", frames=frame, onPage=self.draw_page))
        self._bookmark_id = 0

    def beforeDocument(self):
        # multiBuild performs multiple layout passes so the table of contents
        # can learn its final page numbers. Bookmark keys must remain stable
        # across those passes or the TOC can never converge.
        self._bookmark_id = 0

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style = flowable.style.name
            if style in ("H1X", "H2X", "H3X"):
                level = {"H1X": 0, "H2X": 1, "H3X": 2}[style]
                text = flowable.getPlainText()
                key = f"heading-{self._bookmark_id}"
                self._bookmark_id += 1
                self.canv.bookmarkPage(key)
                if level == 0:
                    self.canv.addOutlineEntry(text, key, level=0, closed=False)
                elif level == 1:
                    self.canv.addOutlineEntry(text, key, level=1, closed=False)
                self.notify("TOCEntry", (level, text, self.page, key))

    def draw_page(self, canvas, doc):
        canvas.saveState()
        w, h = A4
        if doc.page > 1:
            canvas.setStrokeColor(LIGHT_GREY)
            canvas.line(doc.leftMargin, h - 17 * mm, w - doc.rightMargin, h - 17 * mm)
            canvas.setFont("Helvetica-Bold", 8)
            canvas.setFillColor(PURPLE)
            canvas.drawString(doc.leftMargin, h - 13 * mm, "TWINEVAL AI - CURRENT DEPLOYED SYSTEM")
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(GREY)
            canvas.drawRightString(w - doc.rightMargin, h - 13 * mm, "Technical Project Report | Revision 2.0")
            canvas.setStrokeColor(LIGHT_GREY)
            canvas.line(doc.leftMargin, 15 * mm, w - doc.rightMargin, 15 * mm)
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(GREY)
            canvas.drawString(doc.leftMargin, 10 * mm, "Prepared from repository commit 6e587f4")
            canvas.drawRightString(w - doc.rightMargin, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()


def P(text, style="BodyX"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph("- " + text, styles["BulletX"])


def heading(text, level=1):
    return P(text, {1: "H1X", 2: "H2X", 3: "H3X"}[level])


def section_break(title, subtitle=None):
    items = [PageBreak(), heading(title, 1)]
    if subtitle:
        items.append(P(subtitle, "CoverSub"))
    items.append(HRFlowable(width="100%", thickness=2, color=CORAL, spaceBefore=2, spaceAfter=12))
    return items


def callout(title, body, color=PURPLE, background=PALE):
    data = [[P(f"<b>{esc(title)}</b><br/>{body}", "CalloutX")]]
    t = Table(data, colWidths=[166 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.8, color),
        ("LINEBEFORE", (0, 0), (0, -1), 5, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def data_table(rows, widths=None, header=True, font_size=7.6):
    converted = []
    for r, row in enumerate(rows):
        converted.append([P(esc(cell), "SmallX") if not isinstance(cell, Paragraph) else cell for cell in row])
    t = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LIGHT_GREY),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [WHITE, colors.HexColor("#FAFAFC")]),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ])
        for c in range(len(rows[0])):
            converted[0][c] = Paragraph(f"<font color='#FFFFFF'><b>{esc(rows[0][c])}</b></font>", styles["SmallX"])
    t.setStyle(TableStyle(commands))
    return t


def arrow(d, x1, y1, x2, y2, color=GREY):
    d.add(Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=1.5))
    angle = 5
    if x2 >= x1:
        pts = [x2, y2, x2-angle, y2+3, x2-angle, y2-3]
    else:
        pts = [x2, y2, x2+angle, y2+3, x2+angle, y2-3]
    d.add(Polygon(pts, fillColor=color, strokeColor=color))


def architecture_diagram():
    d = Drawing(500, 290)
    boxes = [
        (15, 210, 100, 52, "Student / Teacher\nBrowser", CORAL),
        (150, 210, 100, 52, "Vercel\nStatic Frontend", PURPLE),
        (285, 210, 100, 52, "Render\nNode API", colors.HexColor("#3178C6")),
        (400, 210, 85, 52, "Supabase\nPostgres", GREEN),
        (400, 120, 85, 52, "Supabase\nStorage", GREEN),
        (150, 95, 100, 52, "Local Python\nAI Service :8000", AMBER),
        (15, 95, 100, 52, "Local Ollama\nModels", NAVY),
        (285, 95, 100, 52, "Google OAuth /\nGmail SMTP", colors.HexColor("#4285F4")),
        (150, 15, 100, 42, "PDF Report\nin Browser", CORAL),
    ]
    for x, y, w, h, text, color in boxes:
        d.add(Rect(x, y, w, h, rx=9, ry=9, fillColor=color, strokeColor=color))
        lines = text.split("\n")
        for i, line in enumerate(lines):
            d.add(String(x+w/2, y+h/2+6-i*14, line, textAnchor="middle", fontName="Helvetica-Bold", fontSize=8.5, fillColor=WHITE))
    arrow(d, 115, 236, 150, 236)
    arrow(d, 250, 236, 285, 236)
    arrow(d, 385, 236, 400, 236)
    arrow(d, 327, 210, 435, 172)
    arrow(d, 200, 210, 200, 147)
    arrow(d, 150, 121, 115, 121)
    arrow(d, 285, 121, 250, 121)
    arrow(d, 200, 95, 200, 57)
    d.add(String(265, 190, "REST/JSON + JWT", fontName="Helvetica", fontSize=7, fillColor=GREY))
    d.add(String(205, 175, "Direct localhost AI calls", fontName="Helvetica", fontSize=7, fillColor=GREY))
    return d


def workflow_diagram():
    d = Drawing(500, 210)
    steps = [
        ("1", "Teacher creates paper"),
        ("2", "Local AI extracts questions"),
        ("3", "AI generates answer keys"),
        ("4", "Teacher publishes paper"),
        ("5", "Student uploads script"),
        ("6", "Local AI OCR + evaluates"),
        ("7", "Teacher reviews marks"),
        ("8", "Student views feedback"),
    ]
    coords = [(15,140),(135,140),(255,140),(375,140),(375,45),(255,45),(135,45),(15,45)]
    for (num, label), (x,y) in zip(steps, coords):
        d.add(Rect(x,y,105,48,rx=8,ry=8,fillColor=PALE,strokeColor=PURPLE,strokeWidth=1.2))
        d.add(Rect(x,y,24,48,rx=8,ry=8,fillColor=PURPLE,strokeColor=PURPLE))
        d.add(String(x+12,y+19,num,textAnchor="middle",fontName="Helvetica-Bold",fontSize=10,fillColor=WHITE))
        words = label.split()
        line1 = " ".join(words[:3])
        line2 = " ".join(words[3:])
        d.add(String(x+64,y+27,line1,textAnchor="middle",fontName="Helvetica-Bold",fontSize=7.3,fillColor=NAVY))
        if line2:
            d.add(String(x+64,y+15,line2,textAnchor="middle",fontName="Helvetica",fontSize=7,fillColor=GREY))
    for i in range(3): arrow(d, coords[i][0]+105, coords[i][1]+24, coords[i+1][0], coords[i+1][1]+24, PURPLE)
    arrow(d, 427, 140, 427, 93, PURPLE)
    for i in range(4,7): arrow(d, coords[i][0], coords[i][1]+24, coords[i+1][0]+105, coords[i+1][1]+24, PURPLE)
    return d


def er_diagram():
    d = Drawing(500, 320)
    entities = {
        "Users": (20,240, ["user_id", "email", "role", "google_subject"]),
        "Student": (200,240, ["student_id", "user_id", "roll_no", "semester"]),
        "QuestionPaper": (20,130, ["paper_id", "teacher_id", "status", "pass_percentage"]),
        "Question": (200,130, ["question_id", "paper_id", "max_marks", "group_id"]),
        "AnswerKey": (380,130, ["answer_key_id", "question_id", "data JSON"]),
        "Submission": (20,20, ["submission_id", "paper_id", "student_id", "status", "marks"]),
        "QuestionResult": (200,20, ["result_id", "submission_id", "question_id", "full_result JSON"]),
        "LearningPlan": (380,20, ["plan_id", "student_id", "resources"]),
    }
    positions = {}
    for name,(x,y,fields) in entities.items():
        w,h=110,18+len(fields)*13
        positions[name]=(x,y,w,h)
        d.add(Rect(x,y,w,h,rx=5,ry=5,fillColor=WHITE,strokeColor=PURPLE,strokeWidth=1))
        d.add(Rect(x,y+h-18,w,18,rx=5,ry=5,fillColor=PURPLE,strokeColor=PURPLE))
        d.add(String(x+5,y+h-13,name,fontName="Helvetica-Bold",fontSize=8,fillColor=WHITE))
        for i,f in enumerate(fields):
            d.add(String(x+5,y+h-31-i*13,f,fontName="Courier",fontSize=6.5,fillColor=NAVY))
    links=[("Users","Student"),("Users","QuestionPaper"),("QuestionPaper","Question"),("Question","AnswerKey"),("Student","Submission"),("QuestionPaper","Submission"),("Submission","QuestionResult"),("Question","QuestionResult"),("Student","LearningPlan")]
    for a,b in links:
        ax,ay,aw,ah=positions[a]; bx,by,bw,bh=positions[b]
        x1=ax+aw/2; y1=ay+ah/2; x2=bx+bw/2; y2=by+bh/2
        d.add(Line(x1,y1,x2,y2,strokeColor=colors.HexColor("#B8B9C2"),strokeWidth=0.8))
    return d


def add_paragraphs(story, paragraphs):
    for p in paragraphs:
        story.append(P(p))


story = []

# Cover
story.extend([Spacer(1, 22*mm), P("TWINEVAL AI", "CoverTitle"), P("AI-Assisted Academic Evaluation and Learning Analytics Platform", "CoverSub")])
story.append(Spacer(1, 8*mm))
cover_box = Table([[P("CURRENT DEPLOYED SYSTEM<br/><font size='12'>Complete Technical Project Report and Viva Guide</font>", "CoverSub")]], colWidths=[150*mm], rowHeights=[35*mm])
cover_box.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PALE),("BOX",(0,0),(-1,-1),1.2,PURPLE),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
story.append(cover_box)
story.extend([Spacer(1, 15*mm), P("Prepared by", "CoverSub")])
team = [
    ["ASHWIN KIRBAA B", "714025104028"],
    ["AKHILESHKAR T P", "714025104011"],
    ["ALEN K R", "714025104017"],
    ["ASWIN R", "714025104030"],
]
story.append(data_table([["Team Member", "Register Number"]] + team, [90*mm, 55*mm]))
story.extend([Spacer(1, 12*mm), P("Bachelor of Engineering - Computer Science and Engineering", "CoverSub"), P("Sri Shakthi Institute of Engineering and Technology, Coimbatore", "CoverSub"), Spacer(1, 12*mm)])
story.append(P("Revision 2.0 | 31 October 2026 | Repository commit 6e587f4", "CaptionX"))

# Document control
story.extend(section_break("Document Control and Revision Summary"))
story.append(data_table([
    ["Item", "Current value"],
    ["Document purpose", "Explain the complete deployed TwinEval system for review, demonstration, maintenance, and viva examination."],
    ["Current frontend", "Vercel static deployment: https://twineval-ai.vercel.app"],
    ["Current backend", "Render Node/Express API: https://twineval-api.onrender.com"],
    ["Production data", "Supabase PostgreSQL plus Supabase Storage"],
    ["AI execution", "Local Python Flask service and local Ollama on each client computer"],
    ["Primary local models", "qwen3:4b-instruct for text; gemma3:4b for OCR/vision"],
    ["Authentication", "Gmail-only password signup with email verification, plus Google Identity Services sign-in"],
    ["Source baseline", "GitHub main branch, commit 6e587f4"],
], [46*mm, 120*mm]))
story.append(Spacer(1, 8))
story.append(callout("What changed since the old report", "The earlier report described a mainly local Node + SQLite implementation and treated several functions as unverified. The current application is deployed, uses a Vercel/Render/Supabase architecture, supports Google Sign-In and email verification, stores files persistently, runs AI locally from the browser, includes teacher review and student feedback, and has working analytics and report export paths."))

# TOC
story.extend(section_break("Table of Contents"))
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle(name="TOC1", fontName="Helvetica-Bold", fontSize=10, leading=14, leftIndent=0, firstLineIndent=0, textColor=NAVY, spaceBefore=4),
    ParagraphStyle(name="TOC2", fontName="Helvetica", fontSize=9, leading=12, leftIndent=14, firstLineIndent=0, textColor=PURPLE),
    ParagraphStyle(name="TOC3", fontName="Helvetica", fontSize=8, leading=10, leftIndent=28, firstLineIndent=0, textColor=GREY),
]
story.append(toc)

# Executive summary
story.extend(section_break("1. Executive Summary"))
add_paragraphs(story, [
    "TwinEval AI is a deployed academic evaluation platform that connects paper creation, answer-key generation, answer-sheet processing, AI-assisted marking, teacher review, student feedback, analytics, and report export in one role-based web application.",
    "The current design is deliberately hybrid. Account, paper, submission, and review data are centralized in a cloud API and PostgreSQL database. Computationally expensive and privacy-sensitive AI operations run on the user's own computer through a local Python service and Ollama. The browser therefore communicates with both the public API and localhost:8000.",
    "Teachers create or upload a question paper, allow the local AI to split it into questions and generate structured answer keys, review the generated content, and publish the paper. Students choose a published paper, upload an answer sheet, and start a local OCR and evaluation job. Results are finalized in the API database. Teachers may review the submission, change the total or per-question marks, and add comments. Students then see the final score, question-wise feedback, teacher comments, analytics, and a PDF report.",
    "The AI is decision support, not an autonomous authority. OCR errors, incomplete model answers, unusual correct phrasing, diagrams, formulae, and model variability can affect results. Teacher review is therefore part of the intended workflow, and the report explains where human validation is essential."
])
story.append(callout("One-sentence explanation", "TwinEval is a cloud-hosted assessment portal with a locally executed AI evaluator: the cloud stores identities and academic records, while each authorized user runs OCR and LLM processing on their own machine."))

# Problem and objectives
story.extend(section_break("2. Problem Definition, Objectives, and Scope"))
story.append(heading("2.1 Problem addressed", 2))
add_paragraphs(story, [
    "Manual evaluation of multi-question answer scripts is repetitive, slow, and difficult to scale. Students often receive only a total mark, while teachers must separately manage question papers, answer keys, marks, comments, and performance summaries.",
    "A useful automation system must do more than compare exact words. It must ingest documents, locate questions and answers, recognize alternative phrasing, apply a marking rubric, explain deductions, preserve teacher authority, and maintain an auditable final result."
])
story.append(heading("2.2 Core objectives", 2))
for text in [
    "Provide secure student and educator accounts using verified Gmail identities.",
    "Digitize question papers and answer scripts in PDF, image, DOCX, or TXT form.",
    "Generate editable question-wise model answers, keywords, concepts, expected points, diagrams, Bloom levels, and marking rubrics.",
    "Evaluate objective and descriptive answers with transparent question-level evidence and marks.",
    "Keep teachers in control through review, overrides, comments, and flags.",
    "Give students score summaries, detailed feedback, reviewed answer-script access, analytics, and downloadable reports.",
    "Support both local development and a deployed multi-user environment without placing local LLM workloads on the central server.",
]: story.append(bullet(text))
story.append(heading("2.3 Scope boundaries", 2))
for text in [
    "The system assists academic evaluation; it does not replace institutional moderation or educator judgment.",
    "Local AI requires the Python service, Ollama, and the configured models to be installed on the computer performing the AI task.",
    "Handwriting and diagram recognition depend on scan quality and model capability.",
    "The current frontend intentionally uses local AI even though an optional hosted Gemini service remains in render.yaml as a legacy/alternative blueprint.",
]: story.append(bullet(text))

# Evolution
story.extend(section_break("3. Project Evolution: Old Report vs Current System"))
story.append(data_table([
    ["Area", "Earlier documented state", "Current implemented state"],
    ["Frontend", "Served by the Node application", "Static HTML/CSS/JS built to dist and deployed on Vercel"],
    ["Backend", "Local Express server", "Express API deployed on Render; still runnable locally"],
    ["Database", "SQLite only", "Supabase PostgreSQL in production; SQLite fallback for local use"],
    ["File storage", "Local uploads directory", "Supabase Storage in production; local uploads fallback"],
    ["Identity", "Email/password and JWT", "Verified Gmail password signup, Google Sign-In, JWT, profile/avatar persistence"],
    ["AI topology", "Node-to-local AI bridge", "Deployed browser calls localhost AI directly; Node bridge retained for local/server paths"],
    ["Models", "gemma3:4b described as default", "qwen3:4b-instruct for text generation/evaluation; gemma3:4b for vision/OCR"],
    ["Teacher review", "Described but partly unverified", "Implemented overall and per-question overrides, comments, flags, reviewed status"],
    ["Student feedback", "Score and question breakdown", "Reviewed script, teacher comments, question tabs, final marks, analytics, local PDF"],
    ["Analytics", "Generic or sample data", "Live submission-derived student and class analytics using final reviewed marks"],
    ["Deployment", "Local/LAN emphasis", "Vercel + Render + Supabase with local AI on each client"],
], [31*mm, 60*mm, 75*mm]))

# Users and use cases
story.extend(section_break("4. Users, Roles, and Use Cases"))
story.append(data_table([
    ["Role", "Main responsibilities", "Important permissions"],
    ["Student", "Create account, select paper, upload answer sheet, run local evaluation, view final feedback and analytics, export report", "Can access only their own submissions through authenticated APIs"],
    ["Teacher / Educator", "Create papers, generate answer keys, publish papers, review student submissions, override marks, add comments, view class analytics", "Paper ownership is checked for review and modification"],
    ["Admin", "Administrative role supported by authorization middleware", "Can access operations that accept teacher or admin"],
], [30*mm, 76*mm, 60*mm]))
story.append(heading("4.1 Student use cases", 2))
for text in [
    "Register with Gmail and verify the email, or authenticate using Google Sign-In.",
    "Complete profile details such as roll number, department, semester, college, and avatar.",
    "View available published papers and upload an answer script up to 25 MB.",
    "Run OCR and evaluation using the local AI service and monitor job progress.",
    "Open the score summary, AI feedback workspace, teacher-reviewed script, analytics, and PDF report.",
    "Permanently delete the account through a confirmation-protected settings action.",
]: story.append(bullet(text))
story.append(heading("4.2 Teacher use cases", 2))
for text in [
    "Create a paper from typed questions or uploaded documents.",
    "Generate, inspect, and finalize answer keys before publishing.",
    "View evaluated submissions and distinguish pending review from reviewed work.",
    "Compare AI marks with the answer text, adjust marks, add teacher comments, and flag questions.",
    "Analyze final class performance, AI-teacher agreement, grade distribution, hardest questions, and Bloom-level averages.",
    "Export class analytics as CSV.",
]: story.append(bullet(text))

# Architecture
story.extend(section_break("5. Current System Architecture"))
story.append(architecture_diagram())
story.append(P("Figure 5.1 - Current hybrid cloud/local architecture.", "CaptionX"))
story.append(heading("5.1 Why the architecture is hybrid", 2))
add_paragraphs(story, [
    "A centralized API is necessary for multiple accounts to share papers, submissions, reviews, and analytics. PostgreSQL provides persistent relational data and Supabase Storage preserves uploaded documents and avatars across deployments.",
    "AI processing is separated because free cloud web instances are unsuitable for multi-gigabyte local models and sustained OCR workloads. The browser calls the local AI service directly at 127.0.0.1:8000. This keeps model execution and raw document inference on the user's computer, but it also means every computer that performs AI work must run the local service.",
    "The Vercel build injects the Render API base URL and fixes the AI URL to localhost. This prevents a cloud environment variable from silently routing private documents to a hosted AI provider."
])
story.append(heading("5.2 Component responsibilities", 2))
story.append(data_table([
    ["Component", "Technology", "Responsibility"],
    ["Browser UI", "HTML5, CSS3, vanilla JavaScript", "Role-based screens, validation, API calls, local AI calls, charts, downloads"],
    ["Frontend hosting", "Vercel", "Builds public/ into dist/ and serves static assets globally"],
    ["Central API", "Node.js 22+, Express", "Identity, authorization, papers, submissions, finalization, review, analytics data"],
    ["API hosting", "Render", "Runs npm start and exposes /health and REST routes"],
    ["Database", "Supabase PostgreSQL", "Persistent relational records and foreign-key relationships"],
    ["Object storage", "Supabase Storage", "Persistent avatars and uploaded academic documents"],
    ["Local AI service", "Python, Flask, Flask-CORS", "Extraction, OCR, question splitting, answer keys, evaluation, PDF generation"],
    ["Local model runtime", "Ollama", "Runs qwen3:4b-instruct and gemma3:4b"],
    ["External identity", "Google Identity Services", "Verifies Google ID tokens and links Gmail identity"],
    ["Email", "SMTP / Gmail App Password", "Sends 24-hour verification links for password signup"],
], [34*mm, 40*mm, 92*mm]))

# Stack
story.extend(section_break("6. Technology Stack and Why Each Technology Is Used"))
stack_rows = [
    ["Layer", "Technology", "Reason for selection"],
    ["Frontend", "HTML, CSS, vanilla JavaScript", "Lightweight static deployment, no framework build dependency, direct control over role-based pages"],
    ["API", "Node.js and Express", "Asynchronous I/O, simple REST routing, broad ecosystem, shared JavaScript language with frontend"],
    ["Security", "Helmet, CORS, JWT, bcryptjs", "Security headers, cross-origin access, stateless sessions, password hashing"],
    ["Validation", "express-validator", "Server-side checks for Gmail, passwords, roles, scores, and student data"],
    ["Uploads", "Multer memory storage", "Validates file type/size and forwards buffers to local or Supabase storage"],
    ["Production DB", "PostgreSQL via pg", "Concurrent multi-user cloud persistence with relational integrity"],
    ["Local DB", "node:sqlite", "Zero-install local fallback using the same logical schema"],
    ["Storage", "Supabase JS client", "Server-side object upload and persistent public URLs"],
    ["Email", "Nodemailer", "SMTP verification email delivery"],
    ["Google auth", "google-auth-library", "Back-end verification of Google ID tokens and audience"],
    ["AI API", "Python Flask + Flask-CORS", "Small local HTTP service callable from browser JavaScript"],
    ["Document parsing", "PyMuPDF, python-docx, Pillow", "PDF text/images, DOCX parsing, image handling"],
    ["Text AI", "qwen3:4b-instruct", "Local question splitting, answer-key generation, grading explanations"],
    ["Vision AI", "gemma3:4b", "OCR and transcription of scanned or handwritten pages"],
    ["Semantic analysis", "sentence-transformers, scikit-learn", "Meaning-aware comparison and concept similarity"],
    ["Image processing", "OpenCV, NumPy", "Preprocessing and image-related support"],
    ["Reports", "ReportLab", "Deterministic PDF creation from evaluation data"],
    ["Deployment", "Vercel, Render, Supabase", "Static frontend, managed API, managed database and object storage"],
]
story.append(data_table(stack_rows, [27*mm, 45*mm, 94*mm]))

# Workflows
story.extend(section_break("7. End-to-End Functional Workflow"))
story.append(workflow_diagram())
story.append(P("Figure 7.1 - Complete paper-to-feedback workflow.", "CaptionX"))
story.append(heading("7.1 Question paper workflow", 2))
for text in [
    "The teacher enters title, subject, topic, default marks, and pass percentage.",
    "Questions may be typed or uploaded as PDF, DOCX, TXT, PNG, JPG, or JPEG.",
    "The browser sends the file directly to the local AI job endpoint /jobs/generate-paper.",
    "The AI extracts text, identifies question boundaries and marks, handles grouped instructions such as 'answer any N', and generates a structured answer key for each question.",
    "The teacher reviews the generated questions and answer keys. Finalization stores QuestionPaper, Question, and AnswerKey rows in the central API database.",
    "Publishing changes the paper status from draft to published so students can select it.",
]: story.append(bullet(text))
story.append(heading("7.2 Student evaluation workflow", 2))
for text in [
    "The student selects a published paper and uploads an answer script.",
    "The central API creates a processing submission and stores the uploaded document persistently.",
    "The browser sends the document and paper definition to the local /jobs/evaluate-submission endpoint.",
    "The AI extracts text, divides it into question-wise answers, evaluates each response, and calculates totals, percentage, grade, pass/fail, strengths, weaknesses, and review flags.",
    "The browser finalizes the job by sending the evaluation result to the central API, which writes Submission and QuestionResult records.",
    "The teacher reviews the outcome; the student sees final reviewed data after the status becomes reviewed.",
]: story.append(bullet(text))

# Auth
story.extend(section_break("8. Authentication, Account Lifecycle, and Profiles"))
story.append(heading("8.1 Password-based Gmail registration", 2))
add_paragraphs(story, [
    "Registration accepts only syntactically valid addresses ending in @gmail.com. The email is normalized, the password must contain at least six characters, and bcrypt hashes the password before storage. Student registration also requires roll number, department, and semester so a linked Student row can be created.",
    "If SMTP is configured, the server creates a cryptographically random verification token, stores only its hash and expiration, and sends a verification link that expires after 24 hours. Login is rejected until verification is complete."
])
story.append(heading("8.2 Continue with Google", 2))
add_paragraphs(story, [
    "Google Identity Services returns an ID credential to the browser. The credential is sent to the Node API, where google-auth-library verifies the signature, audience, email_verified claim, Gmail domain, and stable Google subject identifier.",
    "If the selected Gmail already belongs to a TwinEval account, the server links the Google subject when necessary and returns a JWT session. If no account exists, the browser opens the create-account page with the verified name, email, avatar, and Google credential prefilled. The user still selects the role and completes academic profile fields. Google signup does not require a second SMTP verification because Google has already verified ownership of the address."
])
story.append(heading("8.3 Session and profile behavior", 2))
for text in [
    "JWT payload contains user_id, email, name, role, and student_id where applicable.",
    "Default token lifetime is seven days unless JWT_EXPIRES_IN is changed.",
    "The browser stores the token and cached user profile in localStorage and sends Authorization: Bearer <token>.",
    "Profile updates are synchronized with the server. Avatars are uploaded to persistent storage and reloaded after login.",
    "Settings include permanent account deletion with password/confirmation safeguards. Database cascades remove associated owned records where configured.",
]: story.append(bullet(text))

# AI pipeline
story.extend(section_break("9. AI Engine and Evaluation Intelligence"))
story.append(heading("9.1 Local service design", 2))
add_paragraphs(story, [
    "The AI engine is a Flask service with CORS enabled so the deployed Vercel page can call localhost. Long operations run as background jobs. The UI starts a job, receives a job identifier, and polls /jobs/<id> for stage, progress, result, or error. This avoids fragile single HTTP requests during multi-page OCR and per-question inference.",
    "All Ollama calls pass through a centralized timeout-aware wrapper. The default chat timeout is 90 seconds with retry support. This prevents one stalled model request from freezing the entire evaluation indefinitely and allows fallback logic to continue or return an actionable error."
])
story.append(heading("9.2 Document extraction", 2))
for text in [
    "TXT: decoded directly as UTF-8 with error tolerance.",
    "DOCX: paragraph and table text extracted with python-docx.",
    "Digital PDF: PyMuPDF extracts the embedded text layer page by page.",
    "Scanned PDF: image coverage and garbled-text heuristics reject unreliable embedded OCR; the page is rendered at 300 DPI and sent to the vision model.",
    "PNG/JPG/JPEG: saved temporarily and transcribed by gemma3:4b through Ollama.",
    "Optional fallbacks: Gemini OCR if AI_PROVIDER=gemini and a key exists; PaddleOCR only if installed.",
]: story.append(bullet(text))
story.append(heading("9.3 Question and answer segmentation", 2))
add_paragraphs(story, [
    "QuestionAgent detects numbered questions, extracts explicit marks, filters headers/footers, and recognizes group instructions. It uses deterministic parsing first and LLM assistance when needed. StudentAnswerAgent similarly maps extracted answer text to question numbers with regex-first and LLM fallback behavior.",
    "The answer-key generator creates a structured object containing model_answer, keywords, concepts, expected_points, advantages/disadvantages, applications, algorithms/steps, formulae, diagrams, Bloom level, and a marks-distribution rubric. This object is saved as JSON in AnswerKey.data."
])
story.append(heading("9.4 Answer evaluation", 2))
story.append(data_table([
    ["Answer type / condition", "Evaluation behavior"],
    ["Objective / 0.5-1 mark", "Direct match of normalized option letter, true/false, phrase, or strong keyword overlap; normally full or zero marks"],
    ["Descriptive", "Rubric-aware grading based on expected concepts, keywords, points, technical correctness, logical flow, applications, algorithms, formulae, diagrams, and completeness"],
    ["Empty", "Zero marks with explicit no-answer feedback"],
    ["Clearly off-topic", "Zero marks, improvement guidance, and needs_review flag for human checking"],
    ["Alternative phrasing", "Stem-aware term matching and semantic comparison reduce dependence on exact wording"],
    ["Diagram requirement", "Textual references and expected labels are used as a conservative proxy; true visual diagram assessment remains limited"],
], [45*mm, 121*mm]))
story.append(heading("9.5 Result object", 2))
story.append(Preformatted("""{
  marks, max_marks, percentage, grade,
  marks_breakdown, found_concepts, missing_concepts,
  found_keywords, missing_keywords, missing_points,
  missing_diagrams, strengths, improvements, suggestions,
  confidence, bloom_level, topic_relevance,
  feedback, evidence_map, needs_review, review_reason
}""", styles["CodeX"]))
story.append(callout("Human-in-the-loop rule", "Generated answer keys must be checked before publishing, and AI-evaluated marks must remain reviewable. A confident model output can still be wrong if OCR, the model answer, or the rubric is wrong."))

# Scoring
story.extend(section_break("10. Scoring, Grades, Review, and Final Marks"))
story.append(heading("10.1 Grade scale", 2))
story.append(data_table([
    ["Percentage", "Grade"], [">= 90", "A+"], ["80-89.99", "A"], ["70-79.99", "B+"],
    ["60-69.99", "B"], ["50-59.99", "C"], ["40-49.99", "D"], ["< 40", "F"]
], [70*mm, 70*mm]))
story.append(heading("10.2 Overall calculation", 2))
story.append(P("For a submission with awarded question marks m_i and maximum question marks M_i:"))
story.append(callout("Formula", "Total marks = sum(m_i). Maximum marks = sum(M_i). Percentage = (Total marks / Maximum marks) x 100. Pass/fail is compared with the paper's configured pass percentage."))
story.append(heading("10.3 Teacher review", 2))
add_paragraphs(story, [
    "The review workspace shows extracted answers, AI marks, maximum marks, and AI feedback. The teacher can save an overall override, add comments, override individual question results through the API, or flag a question for re-review. Saving the review changes the submission status to reviewed.",
    "Student pages prefer teacher_override_marks whenever it exists. This guarantees the score summary, feedback workspace, analytics, and exported final score represent teacher-approved data rather than the original AI suggestion."
])
story.append(heading("10.4 Analytics calculations", 2))
story.append(data_table([
    ["Metric", "Current calculation"],
    ["Student average", "Average of final percentage for evaluated/reviewed submissions"],
    ["Cumulative GPA", "Final average percentage divided by 10, capped at 10"],
    ["AI evaluator accuracy", "For reviewed items: 100 - |teacher marks - AI marks| / maximum marks x 100"],
    ["Class mean", "Mean of final teacher-reviewed percentages"],
    ["AI-teacher agreement", "Average score similarity between AI total and teacher-approved total"],
    ["Outstanding score count", "Number of final percentages >= 90"],
    ["Grade distribution", "Student count grouped by grade computed from final percentage"],
    ["Hardest question", "Question with the lowest average final question percentage across responses"],
    ["Bloom radar", "Average final question percentage by stored Bloom level"],
], [50*mm, 116*mm]))

# DB
story.extend(section_break("11. Database Design and Data Model"))
story.append(er_diagram())
story.append(P("Figure 11.1 - Main operational data relationships. Three legacy analytics tables are omitted from the drawing for clarity.", "CaptionX"))
story.append(heading("11.1 Dual database adapter", 2))
add_paragraphs(story, [
    "The same model layer supports two database modes. When DATABASE_URL exists, pg connects to PostgreSQL with production SSL. Otherwise Node's built-in node:sqlite opens the local database, enables foreign keys, WAL mode, and a busy timeout. SQL placeholders and insert return values are adapted so existing models work in both modes.",
    "Schema initialization runs automatically at startup. PostgreSQL converts SQLite AUTOINCREMENT definitions to identity columns and creates updated_at triggers. SQLite performs additive migrations for avatar, academic profile, email verification, and Google subject fields."
])
story.append(heading("11.2 Table dictionary", 2))
story.append(data_table([
    ["Table", "Purpose", "Key relationships"],
    ["Users", "Login identity, role, academic profile, avatar, verification, Google identity", "Parent of Student and teacher-owned QuestionPaper"],
    ["Student", "Student academic identity and roll/semester data", "Links Users to Submission, EvaluationResult, LearningPlan"],
    ["QuestionPaper", "Paper metadata, pass percentage, source file, draft/published status", "Owned by Users; parent of Question and Submission"],
    ["Question", "Ordered question text, marks, topic, AI ID, optional group rules", "Belongs to QuestionPaper; parent of AnswerKey and QuestionResult"],
    ["AnswerKey", "Structured generated answer-key JSON", "One-to-one with Question"],
    ["Submission", "Uploaded script, extracted text, AI totals, final override, status, comments", "Belongs to QuestionPaper and Student"],
    ["QuestionResult", "Per-question answer, marks, feedback JSON, flags, override", "Belongs to Submission and Question"],
    ["EvaluationResult", "Legacy/general performance evaluation record", "Belongs to Student"],
    ["LearningPlan", "Weak topics, resources, practice tasks, schedule", "Belongs to Student"],
    ["TeacherAnalytics", "Legacy persisted department analytics", "Independent summary table"],
], [32*mm, 78*mm, 56*mm]))
story.append(heading("11.3 Important states", 2))
story.append(data_table([
    ["Object", "States"],
    ["QuestionPaper.status", "draft, published"],
    ["Submission.status", "processing, evaluated, reviewed, failed"],
    ["Submission.pass_fail", "Pass, Fail, or null while processing"],
    ["Users.role", "admin, teacher, student"],
], [55*mm, 110*mm]))

# API
story.extend(section_break("12. REST API Design"))
story.append(P("All API responses use a standard envelope: success, message, and data for success; success=false and message for errors. Authenticated routes expect a Bearer JWT."))
api_rows = [
    ["Method and route", "Access", "Purpose"],
    ["POST /auth/register", "Public", "Create verified Gmail account; supports Google-assisted signup"],
    ["POST /auth/login", "Public", "Password login after email verification"],
    ["GET /auth/google/config", "Public", "Return configured Google client ID"],
    ["POST /auth/google", "Public", "Verify Google token; login or return signup prefill"],
    ["GET /auth/verify-email", "Public", "Consume verification token"],
    ["GET /auth/me", "JWT", "Return current profile"],
    ["PUT /auth/profile", "JWT", "Update profile"],
    ["POST /auth/avatar", "JWT + upload", "Persist profile image"],
    ["DELETE /auth/account", "JWT", "Permanently remove account"],
    ["POST /papers/generate-job", "Teacher/admin", "Server-bridge generation path"],
    ["GET /papers/generate-job/:jobId", "Teacher/admin", "Poll generation job"],
    ["POST /papers/finalize", "Teacher/admin", "Store generated paper/questions/keys"],
    ["GET /papers", "Current route public", "List/filter papers; frontend uses published or owned views"],
    ["PATCH /papers/:id/publish", "Teacher/admin", "Publish a draft"],
    ["DELETE /papers/:id", "Teacher/admin", "Delete owned paper"],
    ["POST /submissions", "Student + upload", "Create processing submission and persist file"],
    ["POST /submissions/:id/finalize", "Student", "Store AI result"],
    ["POST /submissions/:id/mark-failed", "Student", "Record processing failure"],
    ["GET /submissions", "JWT", "Role-filtered submission list"],
    ["GET /submissions/:id", "JWT", "Submission with question results"],
    ["GET /submissions/:id/report", "JWT", "Report path with local-generation fallback in UI"],
    ["PUT /submissions/:id/override", "Teacher/admin", "Save final total and comments"],
    ["PUT /submissions/:id/questions/:resultId/override", "Teacher/admin", "Save final question mark"],
    ["POST /submissions/:id/questions/:resultId/flag", "JWT", "Flag result for review"],
]
story.append(data_table(api_rows, [64*mm, 35*mm, 67*mm]))
story.append(callout("Security note", "Some legacy GET routes in students, evaluations, plans, analytics, dashboard, and papers remain public in the route files. Production hardening should add authentication and ownership/role checks to every endpoint that exposes academic data." , AMBER, colors.HexColor("#FFF8E8")))

# Frontend
story.extend(section_break("13. Frontend Application"))
story.append(heading("13.1 Page map", 2))
story.append(data_table([
    ["Page", "Role / purpose"],
    ["index.html", "Sign in with password or Google; select student/teacher portal"],
    ["signup.html", "Student or educator account creation; Google-prefilled signup supported"],
    ["verify-email.html", "Completes email verification"],
    ["student-dashboard.html", "Scores, recent activity, paper availability, progress"],
    ["upload-answer.html", "Paper selection and answer script upload"],
    ["processing.html", "Evaluation progress"],
    ["results.html", "Final score summary and PDF report"],
    ["feedback.html", "Question-wise AI feedback, teacher comments, submitted script"],
    ["analytics.html", "Student score trend, Bloom mastery, rubric and AI accuracy"],
    ["teacher-dashboard.html", "Paper/submission overview and pending review"],
    ["teacher-upload.html", "Paper creation and local answer-key generation"],
    ["teacher-review.html", "AI result inspection and teacher approval/override"],
    ["teacher-analytics.html", "Final-score class analytics and CSV export"],
    ["profile.html", "Shared profile and persistent avatar"],
    ["settings.html", "Theme/preferences and permanent account deletion"],
], [55*mm, 111*mm]))
story.append(heading("13.2 Shared client behavior", 2))
for text in [
    "script.js provides API base resolution, JWT fetch wrapper, localStorage session cache, user/avatar rendering, dropdowns, toasts, and SVG charts.",
    "redesign.js normalizes role-specific navigation, injects AI Feedback into every student page, sets role labels, and loads notifications.",
    "ai-local.js isolates direct localhost AI requests and returns clear startup errors when the service is unavailable.",
    "Role-specific modules load live data rather than relying on hardcoded sample values.",
]: story.append(bullet(text))

# File/storage/report
story.extend(section_break("14. File Handling, Storage, and Report Generation"))
story.append(heading("14.1 Upload policy", 2))
add_paragraphs(story, [
    "Multer uses memory storage, limits each upload to 25 MB, and permits .pdf, .png, .jpg, .jpeg, .docx, and .txt. The server sanitizes filenames before persistence.",
    "If Supabase credentials are configured, buffers are uploaded to the twineval-uploads bucket and a public URL is stored. Otherwise the file is written to the local uploads directory and exposed through /uploads."
])
story.append(heading("14.2 Evaluation report PDF", 2))
add_paragraphs(story, [
    "The results page constructs a report payload from the final submission, question text, answer keys, question results, and teacher overrides. It asks the local AI service to generate the PDF with ReportLab and downloads the returned Blob in the browser.",
    "This local path solves the earlier Render 502 problem caused by depending on a remote AI/PDF service. It also ensures teacher-reviewed marks are reflected in the downloaded document."
])
story.append(heading("14.3 CSV analytics", 2))
story.append(P("Student analytics exports paper, subject, date, status, final marks, maximum marks, and final percentage. Teacher analytics exports student, roll number, paper, status, final marks, final percentage, and final grade."))

# UI screenshots
story.extend(section_break("15. Current Application Screens"))
for idx, (path, caption) in enumerate(SCREENSHOTS, 1):
    if path.exists():
        img = Image(str(path))
        iw, ih = ImageReader(str(path)).getSize()
        max_w, max_h = 166*mm, 105*mm
        scale = min(max_w/iw, max_h/ih)
        img.drawWidth, img.drawHeight = iw*scale, ih*scale
        story.append(img)
        story.append(P(f"Figure 15.{idx} - {caption}", "CaptionX"))
        if idx < len(SCREENSHOTS): story.append(PageBreak())

# Deployment
story.extend(section_break("16. Deployment Architecture and Configuration"))
story.append(heading("16.1 Production deployment", 2))
story.append(data_table([
    ["Service", "Configuration"],
    ["Vercel", "Build: npm run build:frontend; output: dist; TWINEVAL_API_BASE points to Render API"],
    ["Render API", "Runtime: Node; build: npm ci; start: npm start; health: /health"],
    ["Supabase", "PostgreSQL connection through DATABASE_URL; Storage through project URL and service-role key"],
    ["Local AI", "Run start-ai-windows.bat on every AI-using computer; health at http://127.0.0.1:8000/health"],
    ["Google Cloud", "OAuth web client must authorize exact Vercel and localhost JavaScript origins"],
    ["Gmail SMTP", "Sender Gmail with two-step verification and a 16-character App Password"],
], [45*mm, 121*mm]))
story.append(heading("16.2 Important environment variables", 2))
story.append(data_table([
    ["Variable", "Used by", "Meaning"],
    ["DATABASE_URL", "API", "Production PostgreSQL connection string"],
    ["DB_PATH", "API", "Local SQLite path when DATABASE_URL is absent"],
    ["JWT_SECRET", "API", "Signs and verifies sessions; must be long and private"],
    ["JWT_EXPIRES_IN", "API", "Token lifetime, default 7d"],
    ["PUBLIC_APP_URL", "API/email", "Frontend origin used in verification links"],
    ["GOOGLE_CLIENT_ID", "API/frontend", "Google OAuth web client audience"],
    ["SMTP_HOST/PORT/SECURE", "API", "SMTP transport"],
    ["SMTP_USER/PASS/FROM", "API", "Verification sender credentials"],
    ["SUPABASE_URL", "API", "Supabase project URL"],
    ["SUPABASE_SERVICE_ROLE_KEY", "API only", "Privileged storage access; never expose to browser"],
    ["SUPABASE_STORAGE_BUCKET", "API", "Default twineval-uploads"],
    ["TWINEVAL_API_BASE", "Vercel build", "Public API origin"],
    ["AI_TEXT_MODEL", "Local AI", "Default qwen3:4b-instruct"],
    ["AI_VISION_MODEL", "Local AI", "Default gemma3:4b"],
    ["OLLAMA_TIMEOUT_SECONDS", "Local AI", "Per-call timeout, default 90"],
    ["OLLAMA_ANSWER_KEY_TIMEOUT_SECONDS", "Local AI", "Longer answer-key timeout, configured as 240"],
], [47*mm, 35*mm, 84*mm]))
story.append(heading("16.3 Why secrets must stay server-side", 2))
story.append(P("Database passwords, JWT_SECRET, SMTP App Password, Supabase service-role key, and any Gemini key must never be committed or placed in Vercel browser variables. Browser-delivered JavaScript is public. Only non-secret origins such as TWINEVAL_API_BASE belong in the frontend build."))

# Running
story.extend(section_break("17. Installation and Execution Guide"))
story.append(heading("17.1 Local prerequisites", 2))
for text in [
    "Node.js 22.5 or newer and npm.",
    "Python environment compatible with the listed AI dependencies.",
    "Ollama desktop/runtime.",
    "qwen3:4b-instruct and gemma3:4b pulled into Ollama.",
    "A configured .env for API/database/auth/email settings.",
]: story.append(bullet(text))
story.append(heading("17.2 Windows startup", 2))
story.append(Preformatted("""1. Run start-ai-windows.bat
2. Confirm http://127.0.0.1:8000/health
3. For local web development, run start-windows.bat
4. Open http://localhost:5000

For the deployed site, only steps 1 and 2 are needed locally,
then open https://twineval-ai.vercel.app""", styles["CodeX"]))
story.append(heading("17.3 Manual commands", 2))
story.append(Preformatted("""npm install
npm run setup
npm start

python -m venv .venv
.venv\\Scripts\\activate
pip install -r ai-engine/requirements.txt
python ai-engine/ai_server.py""", styles["CodeX"]))

# Security
story.extend(section_break("18. Security and Privacy Assessment"))
story.append(heading("18.1 Implemented controls", 2))
for text in [
    "bcrypt password hashing; plaintext passwords are not stored.",
    "JWT verification and role middleware on sensitive write operations.",
    "Google ID tokens are verified server-side against the configured audience.",
    "Email verification tokens are random, hashed in storage, and time limited.",
    "Teacher ownership checks protect paper and submission review operations.",
    "Upload extension and 25 MB size validation.",
    "Helmet security headers with same-origin-allow-popups for Google Sign-In.",
    "Parameterized database queries through adapters.",
    "Service-role storage credential remains on the server.",
]: story.append(bullet(text))
story.append(heading("18.2 Current risks and recommended hardening", 2))
story.append(data_table([
    ["Risk", "Why it matters", "Recommended action"],
    ["Open CORS", "Any origin can call public API routes", "Restrict CORS to deployed and local origins"],
    ["Fallback JWT secret", "A known fallback weakens misconfigured deployments", "Refuse startup in production when JWT_SECRET is missing"],
    ["Public legacy GET routes", "Could expose student or analytics data", "Require JWT and apply role/ownership filters"],
    ["JWT in localStorage", "XSS can steal tokens", "Strengthen CSP; consider secure HttpOnly cookies"],
    ["Public storage bucket", "URLs may be accessible if known", "Use private bucket and signed URLs for answer scripts"],
    ["No rate limiting shown", "Login/upload abuse can consume resources", "Add per-IP and per-account rate limits"],
    ["Account deletion impact", "Cascades may permanently remove academic records", "Add retention policy, export, audit, and institutional approval"],
    ["Local AI CORS", "Local service is reachable from browser origins", "Restrict allowed origins and validate job payloads"],
], [37*mm, 56*mm, 73*mm]))

# Testing
story.extend(section_break("19. Testing and Validation Strategy"))
story.append(heading("19.1 Functional test matrix", 2))
tests = [
    ["ID", "Scenario", "Expected result"],
    ["T01", "Password signup with valid Gmail and SMTP", "Verification email sent; login blocked until verified"],
    ["T02", "Google Sign-In for existing account", "Immediate JWT session and correct dashboard"],
    ["T03", "Google Sign-In for new account", "Signup prefilled with verified name/email/avatar"],
    ["T04", "Student attempts teacher paper write route", "HTTP 403"],
    ["T05", "Upload unsupported extension or >25 MB", "Clear validation error"],
    ["T06", "Generate paper from typed PDF", "Questions, marks, keys, and rubrics appear for review"],
    ["T07", "Generate paper from scanned PDF", "Per-page OCR progress and extracted questions"],
    ["T08", "Evaluate objective answers", "Exact correct answers receive full marks; wrong answers zero"],
    ["T09", "Evaluate descriptive paraphrase", "Semantically correct alternative wording receives appropriate credit"],
    ["T10", "Off-topic answer", "Zero/low mark with needs_review flag"],
    ["T11", "Teacher override", "Student score, feedback, analytics, CSV, and PDF use final marks"],
    ["T12", "Render cold start", "Frontend reports delay gracefully; request succeeds after wake-up"],
    ["T13", "Local AI not running", "Actionable error instructs user to start local engine"],
    ["T14", "PDF report", "Downloads and opens with correct totals and question data"],
    ["T15", "Account deletion", "Confirmation required; account and permitted dependent data removed"],
]
story.append(data_table(tests, [14*mm, 67*mm, 85*mm]))
story.append(heading("19.2 Evaluation quality testing", 2))
add_paragraphs(story, [
    "A credible accuracy claim requires a benchmark set graded independently by qualified educators. For every answer, retain the question, approved answer key, extracted student text, AI mark, human mark, and reason for disagreement.",
    "Recommended measurements include mean absolute mark error, exact agreement for objective questions, weighted kappa for grade bands, correlation, false off-topic rate, OCR word error rate, average latency per page/question, and the percentage of answers sent to human review. Results should be reported by question type and mark range, not only as one overall percentage."
])

# Results/current capabilities
story.extend(section_break("20. Current Results and Demonstrated Capabilities"))
for text in [
    "Frontend and API are deployed separately and configured to communicate across origins.",
    "Supabase PostgreSQL preserves multi-user accounts and academic records; Storage preserves avatars and documents.",
    "Google Sign-In supports existing-account login and new-account prefill.",
    "Password signup supports real Gmail verification through SMTP.",
    "Question-paper generation and answer-sheet evaluation use local background AI jobs.",
    "Teachers can review and approve AI output; students can see reviewed comments and final question marks.",
    "Student AI Feedback is present in the navigation across all student pages.",
    "Student and teacher analytics derive values from live submissions, and teacher analytics use final reviewed marks.",
    "PDF reports are generated by the local AI service; CSV analytics are generated in the browser.",
    "Profile avatars are stored persistently and restored after login.",
    "Permanent account deletion is available in settings.",
]: story.append(bullet(text))
story.append(callout("Do not overclaim", "The repository and deployed UI demonstrate system capability, but they do not by themselves prove grading fairness or accuracy. Such claims require the benchmark process in Section 19.2."))

# Limitations
story.extend(section_break("21. Limitations and Engineering Trade-offs"))
story.append(data_table([
    ["Limitation", "Effect"],
    ["Local AI setup required", "Users cannot generate/evaluate/report until Ollama, models, and Python service are running"],
    ["Large local models", "Initial model download is several GB; CPU-only inference can be slow"],
    ["OCR variability", "Blur, handwriting, formulas, and page layout can change extracted text and downstream marks"],
    ["Generated answer-key quality", "An incorrect key can systematically affect an entire class unless reviewed"],
    ["Text proxy for diagrams", "The evaluator cannot reliably judge visual correctness of a hand-drawn diagram from text alone"],
    ["Render free-tier sleep", "First API request after inactivity may take around a minute"],
    ["Static multi-page frontend", "Shared behavior is duplicated or injected rather than componentized"],
    ["Legacy modules/routes", "EvaluationResult/LearningPlan/TeacherAnalytics and some public endpoints coexist with the newer paper/submission flow"],
    ["No formal audit log", "Mark and account changes are not preserved as a complete immutable history"],
], [50*mm, 116*mm]))

# Future
story.extend(section_break("22. Future Enhancements"))
for text in [
    "Add authenticated, ownership-aware access to every academic read endpoint.",
    "Replace public document URLs with private storage and short-lived signed URLs.",
    "Add immutable audit records for answer-key edits, teacher overrides, account deletion, and publication.",
    "Provide an OCR correction screen before evaluation.",
    "Use real multimodal diagram assessment with explicit teacher confirmation.",
    "Add queue-based asynchronous processing and resumable jobs for large classes.",
    "Provide institutional SSO and domain allowlists in addition to Gmail.",
    "Create rubric versioning so every submission records the exact key/rubric used.",
    "Build calibration dashboards comparing AI and teacher marks by subject and question type.",
    "Add automated unit, integration, security, accessibility, and end-to-end tests in CI.",
    "Add backup/restore procedures and retention controls for Supabase data.",
    "Convert the multi-page frontend into reusable components if maintenance complexity grows.",
]: story.append(bullet(text))

# Repo structure
story.extend(section_break("23. Current Repository Structure"))
story.append(Preformatted("""TwinEval_AI/
|-- public/                 Static frontend pages, CSS, and browser JS
|-- src/
|   |-- config/             SQLite/PostgreSQL database adapter
|   |-- controllers/        Auth, paper, submission, analytics logic
|   |-- middleware/         JWT, roles, validation, uploads, errors
|   |-- models/             SQL data-access layer
|   |-- routes/             Express route definitions
|   `-- services/           AI bridge, email, storage, scoring helpers
|-- ai-engine/
|   |-- agents/             Question, key, OCR, grading, Bloom, feedback
|   |-- services/           End-to-end paper evaluation pipeline
|   |-- utils/              File readers, Ollama client, PDF generator
|   |-- dataset/            Concepts and calibration exemplars
|   `-- ai_server.py        Flask service and background jobs
|-- docs/                   API, deployment, network, schema documents
|-- scripts/                Setup, import, and Vercel frontend build
|-- render.yaml             Render Blueprint
|-- vercel.json             Vercel build configuration
|-- server.js               Node API entry point
|-- start-*.bat/.sh         Local startup scripts
`-- package.json            Node dependencies and scripts""", styles["CodeX"]))

# Troubleshooting
story.extend(section_break("24. Troubleshooting Guide"))
story.append(data_table([
    ["Symptom", "Likely cause", "Resolution"],
    ["Local AI unavailable", "Python service or Ollama not running", "Run start-ai-windows.bat; open /health; verify Ollama app"],
    ["Model not found", "Model not pulled or model name differs", "ollama pull qwen3:4b-instruct and ollama pull gemma3:4b"],
    ["Generation freezes", "Model overloaded or old unbounded call", "Use current timeout wrapper; inspect Ollama; retry after model loads"],
    ["Google origin_mismatch", "Exact frontend origin missing", "Add https://twineval-ai.vercel.app to Authorized JavaScript origins"],
    ["Google popup blank/frozen", "COOP or browser privacy behavior", "Use current same-origin-allow-popups header; allow Google popup/cookies"],
    ["Verification email fails", "SMTP password/host/from invalid", "Use Gmail App Password; verify Render environment variables"],
    ["Registration HTTP 500", "Database migration or SMTP/storage error", "Inspect Render logs; confirm schema initialized and credentials valid"],
    ["Database password authentication failed", "Incorrect/uncoded Supabase connection string", "Reset password and URL-encode special characters"],
    ["PDF download 502", "Old server-side hosted AI path", "Run local AI and use current browser local PDF generation"],
    ["Profile image missing", "Old local-only path or storage misconfiguration", "Configure Supabase Storage; re-upload avatar"],
    ["Render service slow first time", "Free instance cold start", "Wait for wake-up or use paid always-on plan"],
    ["Analytics differs from final score", "Old build used AI percentage", "Deploy commit 6e587f4; refresh cache; final teacher marks are now used"],
], [41*mm, 55*mm, 70*mm]))

# Viva guide
story.extend(section_break("25. Viva and Demonstration Question Bank"))
viva = [
    ("What is TwinEval AI?", "A deployed academic evaluation platform that automates document extraction and produces rubric-based marking suggestions, while preserving teacher review and giving students detailed feedback and analytics."),
    ("What is the main innovation?", "The integration of question-paper generation, local OCR/LLM evaluation, teacher approval, student feedback, and cloud persistence in one hybrid system."),
    ("Why is it called hybrid?", "The frontend, API, database, and storage are cloud-hosted, but AI inference runs locally on each user's computer."),
    ("Why not run Ollama on Render?", "Local models require more memory, storage, and compute than a free web instance can reliably provide. Local execution also reduces external exposure of exam content."),
    ("Why Vercel?", "The frontend is static and Vercel provides simple Git-based deployment, global asset delivery, and build-time environment injection."),
    ("Why Render?", "It provides a managed Node runtime, environment variables, health checks, and Git-based deployment for the Express API."),
    ("Why Supabase?", "It supplies managed PostgreSQL for persistent relational data and Storage for files that must survive Render restarts."),
    ("Why keep SQLite support?", "It makes local development portable and requires no external database server while sharing the same logical model layer."),
    ("What is JWT?", "A signed token that carries user identity and role. The API verifies it on protected requests instead of storing a server-side session."),
    ("How are passwords protected?", "bcrypt hashes passwords with a salt; login compares the supplied password against the stored hash."),
    ("How does Google Sign-In work?", "The browser receives a Google ID token, the backend verifies its signature/audience/verified Gmail, then logs in an existing user or returns verified signup data."),
    ("Why is SMTP still needed?", "Password-based signup does not have Google's proof of ownership, so the server emails a time-limited verification link."),
    ("How are uploads protected?", "The API restricts extensions and enforces a 25 MB limit. Production files are uploaded server-side to Supabase Storage."),
    ("How does PDF OCR work?", "PyMuPDF uses embedded text when trustworthy. Scanned or garbled pages are rendered at 300 DPI and transcribed by the local vision model."),
    ("Why use two models?", "qwen3:4b-instruct is optimized for text generation and reasoning, while gemma3:4b supports image/vision input for OCR."),
    ("How are questions detected?", "Regex and heuristics detect numbering, marks, metadata, and grouped instructions; an LLM fallback handles irregular formats."),
    ("How are objective answers graded?", "Normalized answer matching checks option letters, true/false forms, exact phrases, and strong keyword overlap; short objective items receive full or zero marks."),
    ("How are descriptive answers graded?", "The evaluator checks rubric criteria, expected concepts, keywords, points, technical correctness, completeness, flow, applications, algorithms, formulae, and diagram evidence."),
    ("What is semantic similarity?", "It compares meaning rather than exact wording, helping recognize valid paraphrases. It is evidence, not proof of factual correctness."),
    ("What is Bloom's taxonomy used for?", "Each question/result is classified into cognitive levels such as Remember, Understand, Apply, Analyze, Evaluate, and Create for skill analytics."),
    ("What happens to an off-topic answer?", "It receives zero or very low marks, explanatory feedback, and a needs_review flag so a teacher can check the decision."),
    ("How is the final percentage calculated?", "The sum of awarded question marks is divided by the sum of maximum marks and multiplied by 100."),
    ("Can the teacher change AI marks?", "Yes. The teacher can save an overall final score, comments, and per-question overrides. Student views prefer the override."),
    ("What is AI-teacher agreement?", "It is 100 minus the normalized absolute difference between AI marks and teacher-approved marks, averaged across reviewed submissions."),
    ("Why background jobs?", "OCR plus one model call per question can exceed normal request times. Jobs allow progress polling, retries, and clear error states."),
    ("How does local PDF generation work?", "The results page sends final evaluation data to localhost; ReportLab produces the PDF; the browser downloads the Blob."),
    ("How is data integrity maintained?", "Foreign keys relate users, students, papers, questions, keys, submissions, and results; cascades and unique constraints prevent orphaned/duplicate records."),
    ("What is the biggest technical limitation?", "Evaluation quality depends on OCR, the approved answer key, model behavior, and hardware. Teacher review and benchmark testing remain essential."),
    ("What security issue should be fixed first?", "Protect every academic read endpoint and remove the production fallback JWT secret; then restrict CORS and storage access."),
    ("How would you prove accuracy?", "Use a representative educator-graded benchmark and report mark error, objective accuracy, grade agreement, OCR error, false off-topic rate, and latency by question type."),
    ("What happens if Render sleeps?", "The first API request may be delayed while the free instance wakes. The local AI is independent of that cold start."),
    ("What happens if local AI is off?", "Non-AI account/data pages still use the cloud API, but generation/evaluation/report actions return a clear instruction to start the local engine."),
    ("Why not trust the PDF text layer always?", "Scan applications may embed low-quality OCR. Image-coverage and language heuristics detect suspicious pages and force real OCR."),
    ("What is human-in-the-loop AI?", "AI proposes structured outputs, but a human validates the key and final marks, especially for ambiguous or high-impact decisions."),
    ("What did you personally implement/change?", "The current repository adds deployment, Supabase persistence, Google and email authentication, local AI routing, answer generation/evaluation reliability, review/feedback, PDF fixes, avatars, account deletion, and live analytics corrections."),
]
for q, a in viva:
    story.append(KeepTogether([P(f"<b>Q: {esc(q)}</b>", "H3X"), P(f"<b>A:</b> {esc(a)}", "BodyX")]))

# Glossary
story.extend(section_break("26. Glossary"))
story.append(data_table([
    ["Term", "Meaning in TwinEval"],
    ["API", "HTTP interface used by browser, Node server, and local AI service"],
    ["CORS", "Browser rule controlling cross-origin requests"],
    ["JWT", "Signed session token containing user identity and role"],
    ["LLM", "Language model used for generation and evaluation reasoning"],
    ["OCR", "Conversion of image/scanned writing into machine-readable text"],
    ["Rubric", "Criteria and mark distribution used to grade an answer"],
    ["Semantic similarity", "Measure of meaning-relatedness between texts"],
    ["Bloom level", "Cognitive depth category used for learning analytics"],
    ["Teacher override", "Educator-approved final mark replacing an AI suggestion"],
    ["Background job", "Long AI task executed asynchronously and polled for progress"],
    ["Cold start", "Delay while a sleeping cloud service restarts"],
    ["Supabase service role", "Privileged server-only credential for storage/database operations"],
], [45*mm, 121*mm]))

# Demo checklist
story.extend(section_break("27. Demonstration Checklist"))
for text in [
    "Open Render /health first so the free API is awake.",
    "Start the local AI service and confirm localhost:8000/health.",
    "Keep Ollama open and verify both configured models are installed.",
    "Use a verified teacher account to show paper creation and publishing.",
    "Use a verified student account to upload a short, clearly scanned answer script.",
    "Show job progress and explain that AI runs locally.",
    "Open teacher review, compare AI and extracted answer, save a comment/override.",
    "Return to the student account and show final feedback, analytics, and PDF.",
    "Explain limitations honestly and emphasize human review.",
    "Never display environment secrets during the demonstration.",
]: story.append(bullet(text))

# References
story.extend(section_break("28. References and Source Basis"))
refs = [
    "TwinEval AI source repository: https://github.com/AshwinKirbaa/TwinEval_AI",
    "Current source baseline: main branch commit 6e587f4, 31 October 2026.",
    "Project deployment guide: docs/DEPLOYMENT.md.",
    "Project schema: docs/sqlite/schema.sql.",
    "Node.js documentation: https://nodejs.org/docs/",
    "Express documentation: https://expressjs.com/",
    "PostgreSQL documentation: https://www.postgresql.org/docs/",
    "Supabase documentation: https://supabase.com/docs",
    "Vercel documentation: https://vercel.com/docs",
    "Render documentation: https://render.com/docs",
    "Google Identity Services: https://developers.google.com/identity/gsi/web",
    "Ollama documentation: https://ollama.com/",
    "PyMuPDF documentation: https://pymupdf.readthedocs.io/",
    "Sentence Transformers documentation: https://www.sbert.net/",
    "ReportLab documentation: https://docs.reportlab.com/",
    "B. S. Bloom et al., Taxonomy of Educational Objectives: The Classification of Educational Goals, 1956.",
    "S. Burrows, I. Gurevych, and B. Stein, The Eras and Trends of Automatic Short Answer Grading, International Journal of Artificial Intelligence in Education, 2015.",
]
for i, ref in enumerate(refs, 1): story.append(P(f"[{i}] {esc(ref)}", "SmallX"))
story.append(Spacer(1, 10))
story.append(callout("Report integrity statement", "This report is based on the current repository and the deployed architecture configured in the project. It distinguishes implemented behavior from recommended future work and does not claim unmeasured grading accuracy."))


doc = ReportDocTemplate(
    str(OUT), pagesize=A4,
    rightMargin=22*mm, leftMargin=22*mm,
    topMargin=23*mm, bottomMargin=20*mm,
    title="TwinEval AI - Current Deployed System",
    author="TwinEval AI Project Team",
    subject="Complete technical project report and viva guide",
)
doc.multiBuild(story)
print(OUT)
