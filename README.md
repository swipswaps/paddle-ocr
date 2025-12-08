# PaddleOCR App

A production-ready, Android and Linux compatible document OCR application.

## Features
- **PaddleOCR Backend**: High accuracy, runs locally via Docker.
- **Log Streaming**: Real-time visibility into backend processing (no spinners).
- **Simplified Storage**: Save scans to local PostgreSQL database.
- **LAN Access**: Automated firewall configuration for Android access.

## Quick Start

1. **Start Backend**
   ```bash
   docker compose up -d
   ```

2. **Start Frontend (with network access)**
   ```bash
   ./scripts/start.sh
   ```
   Access at `http://localhost:5173` or your network IP (shown in terminal).

## Architecture
- **Backend**: Python/Flask + PaddleOCR + Gunicorn (threaded).
- **Frontend**: React + TypeScript + Vite.
- **Data**: PostgreSQL `scans` table.

## Troubleshooting
- **Logs not showing?** Ensure Docker container is running.
- **Android can't connect?** Run `./scripts/start.sh` to auto-configure firewall.
