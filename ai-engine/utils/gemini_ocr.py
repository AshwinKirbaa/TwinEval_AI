import os
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

# Load environment variables
load_dotenv()


def extract_handwritten_text(image_path: str) -> str:
    """
    Extract handwritten or printed text from an image using Gemini.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not found in environment or .env file.")

    from google import genai
    client = genai.Client(api_key=api_key)

    image_path = Path(image_path)

    if not image_path.exists():
        raise FileNotFoundError(f"{image_path} not found")

    image = Image.open(image_path)

    prompt = """
    You are a highly accurate OCR engine specialized in reading handwritten university answer sheets.

    Read every visible handwritten or printed word from the image.

    Rules:
    1. Extract the text exactly as written.
    2. Preserve paragraphs, line breaks, numbering, and bullet points.
    3. Do not summarize.
    4. Do not evaluate the answer.
    5. Do not translate.
    6. Do not fix spelling or grammar.
    7. If a word cannot be read confidently, write [unclear].
    8. Ignore page borders and decorative elements.

    Return ONLY the extracted text.
    """

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[prompt, image]
    )

    return response.text.strip()