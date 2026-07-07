from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from google import genai
from fastapi import FastAPI, UploadFile, File
import fitz  # this is PyMuPDF's import name
from fastapi.responses import FileResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
import tempfile

load_dotenv()

app = FastAPI()

@app.post("/upload-resume")
async def upload_resume(file: UploadFile = File(...)):
    # Read the uploaded file into memory
    pdf_bytes = await file.read()

    # Open it with PyMuPDF directly from memory (no need to save to disk)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    extracted_text = ""
    for page in doc:
        extracted_text += page.get_text()

    doc.close()

    return {"resume_text": extracted_text}

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

import time

def generate_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            )
            return response.text
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2)  # wait 2 seconds before trying again
                continue
            raise e  # if all retries fail, raise the error

@app.get("/")
def read_root():
    return {"message": "Hello! Your AI Mock Interviewer backend is alive."}
@app.get("/generate-question")
def generate_question(field: str, resume_text: str = ""):
    if resume_text.strip():
        prompt = f"""You are an interviewer conducting a technical interview for a {field} role.
Here is the candidate's resume:

{resume_text}

Ask ONE realistic interview question that is personalized based on their resume — 
reference a specific project, skill, or experience they mentioned. 
Just output the question, no extra text."""
    else:
        prompt = f"You are an interviewer. Ask ONE realistic technical interview question for a {field} role. Just the question, no extra text."

    question_text = generate_with_retry(prompt)
    return {"question": question_text}


# NEW: a "shape" for the data the frontend will send us
class AnswerRequest(BaseModel):
    field: str
    history: list[dict]  # the full conversation so far
    answer: str          # the user's latest answer

@app.post("/next-question")
def next_question(request: AnswerRequest):
    conversation_text = ""
    for turn in request.history:
        conversation_text += f"{turn['role']}: {turn['content']}\n"

    conversation_text += f"candidate: {request.answer}\n"

    prompt = f"""You are conducting a technical interview for a {request.field} role.
Here is the conversation so far:

{conversation_text}

Based on the candidate's last answer, ask ONE relevant follow-up question.
- If the answer was strong, go deeper into that topic.
- If the answer was weak or vague, ask a simpler clarifying question on the same topic.
Just output the follow-up question, nothing else."""

    question_text = generate_with_retry(prompt)
    return {"question": question_text}

import json

class InterviewReview(BaseModel):
    field: str
    history: list[dict]  # full conversation: interviewer + candidate turns

@app.post("/evaluate-interview")
def evaluate_interview(request: InterviewReview):
    conversation_text = ""
    for turn in request.history:
        conversation_text += f"{turn['role']}: {turn['content']}\n"

    prompt = f"""You are an expert technical interviewer evaluating a candidate for a {request.field} role.

Here is the full interview transcript:

{conversation_text}

Evaluate the candidate's performance. Respond with ONLY valid JSON, no markdown formatting, no backticks, no extra text. Use exactly this structure:

{{
  "overall_score": <number from 0 to 10>,
  "strengths": ["point 1", "point 2"],
  "weaknesses": ["point 1", "point 2"],
  "detailed_feedback": "a short paragraph of overall feedback",
  "recommendation": "Hire" or "No Hire" or "Borderline"
}}"""

    raw_text = generate_with_retry(prompt)
    raw_text = raw_text.strip().replace("```json", "").replace("```", "").strip()

    result = json.loads(raw_text)
    return result

class ReportRequest(BaseModel):
    field: str
    history: list[dict]
    result: dict


@app.post("/generate-report")
def generate_report(request: ReportRequest):
    # Create a temporary file to hold the PDF
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    temp_path = temp_file.name
    temp_file.close()

    doc = SimpleDocTemplate(temp_path, pagesize=A4,
                             topMargin=20*mm, bottomMargin=20*mm)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('TitleStyle', parent=styles['Title'], fontSize=20)
    heading_style = ParagraphStyle('HeadingStyle', parent=styles['Heading2'],
                                    textColor=colors.HexColor('#6c2bd9'))
    normal_style = styles['Normal']

    elements = []

    # Title
    elements.append(Paragraph(f"AI Mock Interview Report", title_style))
    elements.append(Paragraph(f"Field: {request.field}", normal_style))
    elements.append(Spacer(1, 12))

    # Score
    elements.append(Paragraph(f"Overall Score: {request.result['overall_score']} / 10", heading_style))
    elements.append(Paragraph(f"Recommendation: {request.result['recommendation']}", normal_style))
    elements.append(Spacer(1, 12))

    # Strengths
    elements.append(Paragraph("Strengths", heading_style))
    strengths_list = ListFlowable(
        [ListItem(Paragraph(s, normal_style)) for s in request.result['strengths']],
        bulletType='bullet'
    )
    elements.append(strengths_list)
    elements.append(Spacer(1, 12))

    # Weaknesses
    elements.append(Paragraph("Weaknesses", heading_style))
    weaknesses_list = ListFlowable(
        [ListItem(Paragraph(w, normal_style)) for w in request.result['weaknesses']],
        bulletType='bullet'
    )
    elements.append(weaknesses_list)
    elements.append(Spacer(1, 12))

    # Detailed feedback
    elements.append(Paragraph("Detailed Feedback", heading_style))
    elements.append(Paragraph(request.result['detailed_feedback'], normal_style))
    elements.append(Spacer(1, 12))

    # Full transcript
    elements.append(Paragraph("Full Interview Transcript", heading_style))
    for turn in request.history:
        role_label = "Interviewer" if turn['role'] == 'interviewer' else "You"
        elements.append(Paragraph(f"<b>{role_label}:</b> {turn['content']}", normal_style))
        elements.append(Spacer(1, 6))

    doc.build(elements)

    return FileResponse(
        temp_path,
        media_type="application/pdf",
        filename="interview_report.pdf"
    )