import logging
import cv2
import numpy as np
from paddleocr import PaddleOCR

# Initialize OCR engine once (Global) to avoid reloading model per request
# use_angle_cls=True allows detecting rotated text
# lang='en' is standard, but Paddle supports many
try:
    logging.info("[SYSTEM] Initializing PaddleOCR Engine...")
    ocr_engine = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
    logging.info("[SYSTEM] PaddleOCR Engine Ready.")
except Exception as e:
    logging.error(f"[FATAL] Failed to init PaddleOCR: {e}")
    ocr_engine = None

def process_image(img_path, log_callback=None):
    if not ocr_engine:
        raise Exception("OCR Engine not initialized")

    if log_callback: log_callback("Starting analysis...")

    # 1. Run OCR
    # cls=True enables angle classification
    result = ocr_engine.ocr(img_path, cls=True)
    
    if not result or result[0] is None:
        return {'success': False, 'raw_text': '', 'blocks': []}

    # result format: [[[[x1,y1],[x2,y2],[x3,y3],[x4,y4]], (text, confidence)], ...]
    res = result[0]
    
    if log_callback: log_callback(f"Detected {len(res)} text blocks. Processing layout...")

    # 2. Extract Data Structures
    blocks = []
    heights = []
    
    for line in res:
        box = line[0]
        text, conf = line[1]
        
        # Calculate center Y and height for row grouping
        ys = [point[1] for point in box]
        h = max(ys) - min(ys)
        heights.append(h)
        
        # Center Y
        cy = sum(ys) / 4
        
        blocks.append({
            'text': text,
            'box': box,
            'conf': conf,
            'cy': cy,
            'h': h,
            'x_start': min(point[0] for point in box)
        })

    # 3. Layout Analysis (Simple Row Grouping + Column Detection)
    if not blocks:
        return {'success': True, 'raw_text': '', 'blocks': []}

    avg_height = sum(heights) / len(heights)
    
    # Sort by Y position first
    blocks.sort(key=lambda b: b['cy'])
    
    rows = []
    current_row = [blocks[0]]
    
    # Group into rows based on Y proximity (0.5 * avg_height threshold)
    for b in blocks[1:]:
        last_b = current_row[-1]
        if abs(b['cy'] - last_b['cy']) < (avg_height * 0.5):
            current_row.append(b)
        else:
            rows.append(current_row)
            current_row = [b]
    rows.append(current_row)

    if log_callback: log_callback(f"Organized into {len(rows)} rows. Detecting columns...")

    # 4. Construct Text with Column Awareness (Adaptive Gap)
    final_lines = []
    
    for row in rows:
        # Sort row items left-to-right
        row.sort(key=lambda b: b['x_start'])
        
        line_str = ""
        last_x_end = 0
        
        for i, b in enumerate(row):
            box = b['box']
            curr_x_start = min(p[0] for p in box)
            curr_x_end = max(p[0] for p in box)
            
            if i > 0:
                gap = curr_x_start - last_x_end
                # Adaptive Gap Detection:
                # If gap is significantly larger than typical char width (approx height/2),
                # assume it's a column break.
                # Threshold: 3 * (height/2) = 1.5 * height roughly
                if gap > (avg_height * 2.0):
                    line_str += "\t\t" # Double tab for wide columns
                elif gap > (avg_height * 0.5):
                    line_str += "\t"   # Tab for distinct words
                else:
                    line_str += " "    # Space for close words
            
            line_str += b['text']
            last_x_end = curr_x_end
            
        final_lines.append(line_str)

    full_text = "\n".join(final_lines)
    
    # Stream the result back to UI log for instant feedback
    if log_callback: log_callback("[STREAM_DATA] " + full_text)

    return {
        'success': True,
        'raw_text': full_text,
        'blocks': blocks,
        'row_count': len(rows)
    }
