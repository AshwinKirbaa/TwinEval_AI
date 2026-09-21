import cv2
import numpy as np
from PIL import Image


def preprocess_image_for_ocr(image_path: str) -> np.ndarray:
    """
    Preprocess image for better OCR contrast and legibility.
    Converts to grayscale and applies adaptive thresholding.
    """
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Unable to read image at path: {image_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )
    return thresh


def resize_image_if_large(image: Image.Image, max_dim: int = 1920) -> Image.Image:
    """
    Resizes PIL image if max dimension exceeds max_dim to speed up OCR vision inference.
    """
    width, height = image.size
    if max(width, height) <= max_dim:
        return image

    if width > height:
        new_width = max_dim
        new_height = int(height * (max_dim / width))
    else:
        new_height = max_dim
        new_width = int(width * (max_dim / height))

    return image.resize((new_width, new_height), Image.Resampling.LANCZOS)
