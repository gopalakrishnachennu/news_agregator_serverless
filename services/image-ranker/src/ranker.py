import cv2
import numpy as np
import requests
from PIL import Image
from io import BytesIO

def download_image(url, referer=None):
    try:
        headers = {
            'User-Agent': 'NewsAggregatorBot/1.0',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
        if referer:
            headers['Referer'] = referer
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            return resp.content
        return None
    except:
        return None

def get_blur_score(image_bytes):
    try:
        # Convert to numpy array
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return 0
        return cv2.Laplacian(img, cv2.CV_64F).var()
    except:
        return 0

def score_candidate(candidate, image_data):
    if not image_data:
        return 0, "Failed to download"

    try:
        img = Image.open(BytesIO(image_data))
        width, height = img.size
        
        # 1. Reject tiny images (relaxed for better coverage)
        if width < 200 or height < 150:
            return 0, "Too small"
            
        # 2. Aspect Ratio (Favor Landscape)
        aspect = width / height
        if aspect < 0.5 or aspect > 3.0: # Too tall or too wide
            return 0, "Bad aspect ratio"
        
        # 3. Blur Detection
        blur_score = get_blur_score(image_data)
        if blur_score < 50: # Very blurry
            return 0, "Too blurry"

        # 4. Calculate weighted score
        # Base: Resolution (capped at 1.0 for 1200px)
        res_score = min(1.0, width / 1200.0)
        
        # Aspect Bonus (close to 16:9 = 1.77)
        aspect_bonus = 0.2 if 1.3 < aspect < 2.0 else 0
        
        # Source Priority (passed from Parser)
        source_modifier = candidate.get('scoreModifier', 0.5)
        
        final_score = (res_score * 40) + (source_modifier * 40) + (aspect_bonus * 20)
        
        return final_score, "OK"
        
    except Exception as e:
        return 0, f"Error: {str(e)}"

def process_image(image_bytes):
    # Resize and convert to WebP
    img = Image.open(BytesIO(image_bytes))
    
    # Resize to max width 1200 keeping aspect
    if img.width > 1200:
        ratio = 1200 / img.width
        new_height = int(img.height * ratio)
        img = img.resize((1200, new_height), Image.Resampling.LANCZOS)
        
    output = BytesIO()
    img.save(output, format="WEBP", quality=85)
    return output.getvalue()
