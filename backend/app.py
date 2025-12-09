import os
import time
import json
import logging
import threading
import queue
import psutil
import psycopg2
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename
from psycopg2.extras import RealDictCursor
import sys

# Import OCR logic
try:
    from ocr import process_image
except ImportError:
    # Fallback for when running directly without package structure
    from backend.ocr import process_image

app = Flask(__name__)
CORS(app)

# --- Configuration ---
UPLOAD_FOLDER = '/tmp/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'tiff', 'bmp', 'gif'}
DB_HOST = os.environ.get('DB_HOST', 'db')
DB_NAME = os.environ.get('DB_NAME', 'receipts')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASS', 'postgres')

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- Logging & SSE Setup ---
# Thread-safe queue for log distribution
log_queue = queue.Queue(maxsize=1000)

class LogBufferHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            log_queue.put(json.dumps({
                'ts': record.created,
                'level': record.levelname,
                'msg': msg
            }))
        except queue.Full:
            pass # Drop logs if queue is full to prevent blocking

# Setup Root Logger
logger = logging.getLogger()
logger.setLevel(logging.INFO)
buffer_handler = LogBufferHandler()
formatter = logging.Formatter('%(message)s')
buffer_handler.setFormatter(formatter)
logger.addHandler(buffer_handler)

# Capture stdout/stderr to push to log_queue as well (for Paddle/System logs)
class StreamToLogger(object):
    def __init__(self, logger, level):
        self.logger = logger
        self.level = level
        self.linebuf = ''

    def write(self, buf):
        for line in buf.rstrip().splitlines():
            self.logger.log(self.level, line.rstrip())

    def flush(self):
        pass

sys.stdout = StreamToLogger(logger, logging.INFO)
sys.stderr = StreamToLogger(logger, logging.ERROR)

# --- Database Helpers ---
def get_db_connection():
    conn = psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )
    return conn

def init_db():
    """Initialize database schema on startup"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS scans (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL,
                raw_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        logging.info("[SYSTEM] Database initialized successfully.")
    except Exception as e:
        logging.error(f"[SYSTEM] Database init failed: {e}")

# Initialize DB immediately
init_db()

# --- System Monitoring Thread ---
def monitor_system():
    """Background thread to push system stats to logs"""
    while True:
        try:
            # 1. Basic Metrics
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory()
            net = psutil.net_io_counters()
            net_rx_mb = net.bytes_recv / (1024 * 1024)
            
            metric_msg = f"[METRIC] CPU: {cpu}% RAM: {mem.used//(1024*1024)}/{mem.total//(1024*1024)}MB NET_RX: {net_rx_mb:.1f}MB"
            logger.info(metric_msg)

            # 2. Top Processes (mock 'top')
            procs = []
            for proc in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_percent']):
                try:
                    pinfo = proc.info
                    # Filter for relevant processes
                    if pinfo['cpu_percent'] > 0.0 or 'python' in pinfo['name'] or 'gunicorn' in pinfo['name']:
                        procs.append(pinfo)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            # Sort by CPU usage
            procs.sort(key=lambda x: x['cpu_percent'], reverse=True)
            top_procs = procs[:5] # Top 5
            
            logger.info(f"[TOP] {json.dumps(top_procs)}")
            
            time.sleep(2) 
        except Exception as e:
            time.sleep(5)

# Start Monitor
monitor_thread = threading.Thread(target=monitor_system, daemon=True)
monitor_thread.start()

# --- Routes ---

@app.route('/health', methods=['GET'])
def health():
    try:
        mem = psutil.virtual_memory()
        return jsonify({
            'status': 'online',
            'cpu_percent': psutil.cpu_percent(),
            'memory_used': mem.used / (1024 * 1024),
            'memory_total': mem.total / (1024 * 1024)
        })
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500

@app.route('/logs/stream')
def stream_logs():
    def generate():
        while True:
            try:
                # Get log from queue, wait up to 1s
                msg_data = log_queue.get(timeout=1.0)
                yield f"data: {msg_data}\n\n"
            except queue.Empty:
                # Send heartbeat to keep connection alive
                yield ": heartbeat\n\n"
            except GeneratorExit:
                break
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/ocr', methods=['POST'])
def run_ocr():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        logging.info(f"[OCR INFO] Processing file: {filename}")
        
        try:
            # Pass a callback to push specific OCR progress updates
            def progress_callback(msg):
                logging.info(f"[OCR INFO] {msg}")

            result = process_image(filepath, log_callback=progress_callback)
            
            # Save to DB
            try:
                conn = get_db_connection()
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO scans (filename, raw_text) VALUES (%s, %s) RETURNING id",
                    (filename, result['raw_text'])
                )
                scan_id = cur.fetchone()[0]
                conn.commit()
                cur.close()
                conn.close()
                result['db_id'] = scan_id
                logging.info(f"[OCR INFO] Saved to database ID: {scan_id}")
            except Exception as e:
                logging.error(f"[ERROR] DB Save failed: {e}")

            return jsonify(result)
        
        except Exception as e:
            logging.error(f"[ERROR] OCR Processing Failed: {str(e)}")
            return jsonify({'error': str(e)}), 500
            
    return jsonify({'error': 'File type not allowed'}), 400

@app.route('/scans', methods=['GET'])
def list_scans():
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM scans ORDER BY created_at DESC LIMIT 50")
        scans = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify({'scans': scans})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/scans/<int:scan_id>', methods=['DELETE'])
def delete_scan(scan_id):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM scans WHERE id = %s", (scan_id,))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Use threaded=True for dev server to support SSE + processing
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)
