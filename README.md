# PaddleOCR App

A production-ready, Android and Linux compatible document OCR application. This project provides a robust interface for scanning receipts and documents using the high-accuracy PaddleOCR engine, with a focus on usability, network accessibility, and transparency.

## 🚀 Key Features

*   **PaddleOCR Integration**: Utilizes the powerful PP-OCRv4 model for high-accuracy text detection and recognition.
*   **Column-Aware Parsing**: Intelligent post-processing to correctly handle multi-column layouts common in receipts and invoices.
*   **Real-time Log Streaming**: detailed, verbatim logs from the backend (stdout/stderr) are streamed via SSE, ensuring you know exactly what the OCR engine is doing during long processes.
*   **Mobile Optimized**: Automated network configuration allows Android devices on the local LAN to access the app seamlessly.
*   **Persistent Storage**: Scans are saved to a PostgreSQL database (`scans` table) for easy retrieval and export.
*   **Robust Image Handling**: Automatic HEIC conversion and EXIF orientation normalization.

## 🛠 Tech Stack

*   **Frontend**: React 18, TypeScript, Vite
*   **Backend**: Python 3.9, Flask, Gunicorn (Threaded), PaddleOCR (CPU mode)
*   **Database**: PostgreSQL
*   **Infrastructure**: Docker Compose

## 📦 Prerequisites

*   **Docker** and **Docker Compose** installed on your machine.
*   Available ports: `5173` (Frontend), `5001` (Backend), `5432` (Database).

## 🏁 Quick Start

1.  **Start the Stack**
    Run the start script to initialize the database, configure firewall rules (Linux/macOS), and launch the containers.
    ```bash
    ./scripts/start.sh
    ```
    *Note: If you don't have the script, run `docker compose up -d` manually.*

2.  **Access the App**
    *   **Localhost**: [http://localhost:5173](http://localhost:5173)
    *   **LAN (Phone/Tablet)**: Use the IP address shown in the terminal output (e.g., `http://192.168.1.100:5173`).

3.  **Stop the App**
    Use the stop script to clean up firewall rules and containers.
    ```bash
    ./scripts/stop.sh
    ```

## 📂 Architecture

### Database Schema
The application uses a simplified schema for flexibility:
```sql
CREATE TABLE scans (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    raw_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Logging System
1.  **Backend**: Gunicorn runs with `--threads 4`. A custom `LogBufferHandler` captures Python `logging`, `stdout`, and `stderr`.
2.  **Transport**: Logs are pushed to the frontend via Server-Sent Events (SSE) at `/logs/stream`.
3.  **Frontend**: The `backendLogService` parses these events (handling various formats like JSON or raw strings) and displays them in the "System Logs" panel.

## 🔧 Troubleshooting

### "Backend Offline" Indicator
*   Ensure the `backend` container is running: `docker compose ps`.
*   Check if port `5001` is exposed.

### Logs are empty or sparse
*   The system uses SSE. Ensure no proxy (like Nginx default config) is buffering the response.
*   Wait a few seconds; PaddleOCR model loading (first run) can be silent for 10-20 seconds.

### "Result is blank"
*   This usually means text was detected but filtered out, or the response structure mismatch. Check the "System Logs" for the "Response received. Fields: ..." entry to debug.

## 📜 License
Based on work from [swipswaps/receipts-ocr](https://github.com/swipswaps/receipts-ocr).
