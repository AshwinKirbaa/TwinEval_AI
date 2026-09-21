import html
import os
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak


def clean_txt(text):
    if not text:
        return ""
    return html.escape(str(text))


def generate_pdf(
        student,
        teacher,
        topic,
        result
):
    """
    Generates AI Evaluation Report PDF from evaluation result dict.
    Returns the generated PDF file path.
    """
    os.makedirs("output", exist_ok=True)

    reg_no = getattr(student, "register_no", "Student")
    pdf_path = os.path.join(
        "output",
        f"{reg_no}_Evaluation_Report.pdf"
    )

    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(pdf_path)
    elements = []

    # Title
    elements.append(
        Paragraph("<b>AI Paper Evaluation Report</b>", styles["Title"])
    )
    elements.append(Spacer(1, 15))

    # Student Details
    elements.append(Paragraph("<b>Student Details</b>", styles["Heading2"]))
    elements.append(Paragraph(f"Name : {clean_txt(getattr(student, 'name', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Register No : {clean_txt(getattr(student, 'register_no', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Department : {clean_txt(getattr(student, 'department', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Semester : {clean_txt(getattr(student, 'semester', ''))}", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Teacher Details
    elements.append(Paragraph("<b>Teacher Details</b>", styles["Heading2"]))
    elements.append(Paragraph(f"Teacher : {clean_txt(getattr(teacher, 'name', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Subject : {clean_txt(getattr(teacher, 'subject', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Topic : {clean_txt(topic)}", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Evaluation Summary
    elements.append(Paragraph("<b>Evaluation Summary</b>", styles["Heading2"]))
    marks = result.get("marks", 0)
    total = getattr(teacher, "max_marks", 10)
    percentage = result.get("percentage", 0)
    grade = result.get("grade", "F")
    feedback = result.get("feedback", "")

    elements.append(Paragraph(f"<b>Total Marks : {marks} / {total}</b>", styles["BodyText"]))
    elements.append(Paragraph(f"Percentage : {percentage}%", styles["BodyText"]))
    elements.append(Paragraph(f"Grade : {clean_txt(grade)}", styles["BodyText"]))
    elements.append(Paragraph(f"Feedback : {clean_txt(feedback)}", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Bloom Taxonomy
    elements.append(Paragraph("<b>Bloom Taxonomy</b>", styles["Heading2"]))
    elements.append(Paragraph(f"Detected Level : {clean_txt(result.get('bloom_level', 'Understand'))}", styles["BodyText"]))
    elements.append(Paragraph(f"Confidence : {result.get('confidence', 0)}%", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Concepts Found
    elements.append(Paragraph("<b>Concepts Found</b>", styles["Heading2"]))
    found = result.get("found_concepts", [])
    if found:
        for item in found:
            elements.append(Paragraph(f"• {clean_txt(item)}", styles["BodyText"]))
    else:
        elements.append(Paragraph("None", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Missing Concepts
    elements.append(Paragraph("<b>Missing Concepts</b>", styles["Heading2"]))
    missing = result.get("missing_concepts", [])
    if missing:
        for item in missing:
            elements.append(Paragraph(f"• {clean_txt(item)}", styles["BodyText"]))
    else:
        elements.append(Paragraph("None", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Strengths
    elements.append(Paragraph("<b>Strengths</b>", styles["Heading2"]))
    strengths = result.get("strengths", [])
    if strengths:
        for item in strengths:
            elements.append(Paragraph(f"• {clean_txt(item)}", styles["BodyText"]))
    else:
        elements.append(Paragraph("None", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Improvements
    elements.append(Paragraph("<b>Areas to Improve</b>", styles["Heading2"]))
    improvements = result.get("improvements", [])
    if improvements:
        for item in improvements:
            elements.append(Paragraph(f"• {clean_txt(item)}", styles["BodyText"]))
    else:
        elements.append(Paragraph("No improvements needed.", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    # Suggestions
    elements.append(Paragraph("<b>Suggestions</b>", styles["Heading2"]))
    suggestions = result.get("suggestions", [])
    if suggestions:
        for item in suggestions:
            elements.append(Paragraph(f"• {clean_txt(item)}", styles["BodyText"]))
    else:
        elements.append(Paragraph("None", styles["BodyText"]))

    doc.build(elements)
    return pdf_path

def _bullet_list(elements, items, styles, empty_text="None"):
    if items:
        for item in items:
            elements.append(Paragraph(f"• {clean_txt(item)}", styles["BodyText"]))
    else:
        elements.append(Paragraph(empty_text, styles["BodyText"]))


def generate_full_report_pdf(student, teacher, questions, results, overall):
    """
    Generates the full multi-question AI Evaluation Report PDF for the
    redesigned paper-evaluation workflow.

    student, teacher : models.student.Student / models.teacher.Teacher
    questions        : list[models.question.Question]
    results          : list[dict]  (per-question AnswerEvaluationAgent.evaluate() output,
                                     each augmented with question_id/question_text/max_marks)
    overall          : dict        (PaperEvaluationService.build_overall_report() output)

    Returns the generated PDF file path. Does not modify or replace
    generate_pdf(), which remains available for the original
    single-answer-key workflow.
    """
    os.makedirs("output", exist_ok=True)

    reg_no = getattr(student, "register_no", "Student")
    pdf_path = os.path.join("output", f"{reg_no}_Full_Evaluation_Report.pdf")

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="QuestionHeading", parent=styles["Heading2"], textColor=colors.HexColor("#1a3d7c")))
    doc = SimpleDocTemplate(pdf_path, pagesize=A4)
    elements = []

    # ---------------------------------------------------
    # Title & Details
    # ---------------------------------------------------
    elements.append(Paragraph("<b>AI Paper Evaluation Report</b>", styles["Title"]))
    elements.append(Spacer(1, 15))

    elements.append(Paragraph("<b>Student Details</b>", styles["Heading2"]))
    elements.append(Paragraph(f"Name : {clean_txt(getattr(student, 'name', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Register No : {clean_txt(getattr(student, 'register_no', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Department : {clean_txt(getattr(student, 'department', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Semester : {clean_txt(getattr(student, 'semester', ''))}", styles["BodyText"]))
    elements.append(Spacer(1, 10))

    elements.append(Paragraph("<b>Teacher Details</b>", styles["Heading2"]))
    elements.append(Paragraph(f"Teacher : {clean_txt(getattr(teacher, 'name', ''))}", styles["BodyText"]))
    elements.append(Paragraph(f"Subject : {clean_txt(getattr(teacher, 'subject', ''))}", styles["BodyText"]))
    elements.append(Spacer(1, 15))

    # ---------------------------------------------------
    # Overall Summary
    # ---------------------------------------------------
    elements.append(Paragraph("<b>Overall Result</b>", styles["Heading2"]))
    summary_data = [
        ["Total Marks", f"{overall.get('total_marks', 0)} / {overall.get('max_marks', 0)}"],
        ["Percentage", f"{overall.get('percentage', 0)}%"],
        ["Grade", clean_txt(overall.get('grade', 'F'))],
        ["Result", clean_txt(overall.get('pass_fail', 'Fail'))],
    ]
    table = Table(summary_data, colWidths=[150, 300])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2fb")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 12))

    elements.append(Paragraph("<b>Overall Strengths</b>", styles["Heading3"]))
    _bullet_list(elements, overall.get("overall_strengths", []), styles)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("<b>Overall Weaknesses</b>", styles["Heading3"]))
    _bullet_list(elements, overall.get("overall_weaknesses", []), styles)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("<b>Frequently Missed Concepts</b>", styles["Heading3"]))
    _bullet_list(elements, overall.get("frequently_missed_concepts", []), styles)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("<b>Topics to Revise</b>", styles["Heading3"]))
    _bullet_list(elements, overall.get("topics_to_revise", []), styles)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("<b>Personalized Recommendations</b>", styles["Heading3"]))
    _bullet_list(elements, overall.get("recommendations", []), styles)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("<b>Study Suggestions</b>", styles["Heading3"]))
    _bullet_list(elements, overall.get("study_suggestions", []), styles)

    # ---------------------------------------------------
    # Per-Question Breakdown
    # ---------------------------------------------------
    elements.append(PageBreak())
    elements.append(Paragraph("<b>Question-wise Evaluation</b>", styles["Title"]))
    elements.append(Spacer(1, 10))

    question_by_id = {q.id: q for q in questions} if questions and hasattr(questions[0], "id") else {}

    for idx, result in enumerate(results, start=1):
        q_text = result.get("question_text", "")
        elements.append(Paragraph(f"<b>Q{idx}. {clean_txt(q_text)}</b>", styles["QuestionHeading"]))

        marks = result.get("marks", 0)
        max_marks = result.get("max_marks", 10)
        elements.append(Paragraph(
            f"Marks: <b>{marks} / {max_marks}</b> &nbsp;&nbsp; "
            f"Percentage: {result.get('percentage', 0)}% &nbsp;&nbsp; "
            f"Grade: {clean_txt(result.get('grade', 'F'))} &nbsp;&nbsp; "
            f"Bloom Level: {clean_txt(result.get('bloom_level', 'Understand'))} &nbsp;&nbsp; "
            f"Confidence: {result.get('confidence', 0)}%",
            styles["BodyText"],
        ))

        if result.get("is_off_topic"):
            elements.append(Paragraph(
                "<font color='red'><b>Flagged as off-topic / wrong-topic answer.</b></font>",
                styles["BodyText"],
            ))

        elements.append(Paragraph(f"<i>Feedback:</i> {clean_txt(result.get('feedback', ''))}", styles["BodyText"]))
        elements.append(Spacer(1, 4))

        elements.append(Paragraph("Found Concepts:", styles["Heading4"]))
        _bullet_list(elements, result.get("found_concepts", []), styles)

        elements.append(Paragraph("Missing Concepts:", styles["Heading4"]))
        _bullet_list(elements, result.get("missing_concepts", []), styles)

        elements.append(Paragraph("Missing Keywords:", styles["Heading4"]))
        _bullet_list(elements, result.get("missing_keywords", []), styles)

        elements.append(Paragraph("Missing Points:", styles["Heading4"]))
        _bullet_list(elements, result.get("missing_points", []), styles)

        elements.append(Paragraph("Missing Diagrams:", styles["Heading4"]))
        _bullet_list(elements, result.get("missing_diagrams", []), styles)

        elements.append(Paragraph("Strengths:", styles["Heading4"]))
        _bullet_list(elements, result.get("strengths", []), styles)

        elements.append(Paragraph("Areas to Improve:", styles["Heading4"]))
        _bullet_list(elements, result.get("improvements", []), styles)

        elements.append(Paragraph("Suggestions:", styles["Heading4"]))
        _bullet_list(elements, result.get("suggestions", []), styles)

        elements.append(Spacer(1, 14))

    doc.build(elements)
    return pdf_path
