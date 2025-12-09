import { API_BASE } from '../config';
import { OcrResponse, Scan, BackendLogEntry } from '../types';
import { backendLogService } from './backendLogService';

export const ocrService = {
  async processWithDocker(
    file: File, 
    onLog?: (msg: string, ts?: number) => void
  ): Promise<OcrResponse> {
    
    // Subscribe to logs
    const stopLogging = backendLogService.startStreaming((log) => {
        if (!log || !log.msg) return;
        const timestamp = log.ts ? log.ts * 1000 : Date.now();
        const msg = log.msg;

        // Pass through everything to the UI logger
        // The UI handles coloring based on content (e.g. [OCR] vs [METRIC])
        onLog?.(msg, timestamp);
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const data = await new Promise<OcrResponse>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${API_BASE}/ocr`);
          xhr.timeout = 180000; // 3 minutes

          // Upload Progress
          xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                  const percent = Math.round((event.loaded / event.total) * 100);
                  const totalMB = (event.total / (1024 * 1024)).toFixed(2);
                  
                  if (percent === 0 || percent % 10 === 0 || percent === 100) {
                     onLog?.(`[SYSTEM] Uploading... ${percent}% (${totalMB} MB)`, Date.now());
                  }
              }
          };

          xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                      resolve(JSON.parse(xhr.responseText));
                  } catch (e) {
                      reject(new Error('Invalid JSON response'));
                  }
              } else {
                  reject(new Error(`Backend error: ${xhr.status}`));
              }
          };

          xhr.ontimeout = () => reject(new Error('Request timed out'));
          xhr.onerror = () => reject(new Error('Network request failed'));
          
          onLog?.(`[SYSTEM] Initializing upload of ${file.name}...`, Date.now());
          xhr.send(formData);
      });

      return data;
    } finally {
      stopLogging();
    }
  },

  async listScans(): Promise<Scan[]> {
    try {
      const res = await fetch(`${API_BASE}/scans`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.scans) ? data.scans : [];
    } catch (error) {
      return []; 
    }
  },

  async saveScan(filename: string, raw_text: string): Promise<number> {
    const res = await fetch(`${API_BASE}/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, raw_text })
    });
    if (!res.ok) throw new Error('Failed to save scan');
    const data = await res.json();
    return data.id;
  },

  async deleteScan(id: number): Promise<void> {
    await fetch(`${API_BASE}/scans/${id}`, { method: 'DELETE' });
  },

  async clearAllScans(): Promise<void> {
    await fetch(`${API_BASE}/scans/clear`, { method: 'DELETE' });
  }
};