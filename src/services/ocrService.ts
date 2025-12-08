import { API_BASE } from '../config';
import { OcrResponse, Scan, BackendLogEntry } from '../types';
import { backendLogService } from './backendLogService';
import { dockerHealthService } from './dockerHealthService';

export const ocrService = {
  async processWithDocker(
    file: File, 
    onLog?: (msg: string, ts?: number) => void
  ): Promise<OcrResponse> {
    
    // Pause health checks to avoid false negatives during busy OCR
    dockerHealthService.pauseMonitoring();
    
    // Start streaming logs
    const stopLogging = backendLogService.startStreaming((log) => {
        if (log && log.msg) {
          // Backend sends seconds, convert to ms for frontend consistency
          const timestamp = log.ts ? log.ts * 1000 : Date.now();
          onLog?.(log.msg, timestamp);
        }
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      onLog?.('Sending to PaddleOCR backend...');
      onLog?.('Waiting for PaddleOCR response (this may take 60-90s for large images)...');

      const response = await fetch(`${API_BASE}/ocr`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data: OcrResponse = await response.json();
      
      const cols = data.column_count || 1;
      const rows = data.row_count || data.blocks.length;
      onLog?.(`OCR complete: ${data.blocks.length} text blocks, ${cols} columns, ${rows} rows detected`);

      return data;
    } finally {
      stopLogging();
      dockerHealthService.resumeMonitoring();
    }
  },

  async listScans(): Promise<Scan[]> {
    try {
      const res = await fetch(`${API_BASE}/scans`);
      if (!res.ok) throw new Error('Failed to fetch scans');
      
      const data = await res.json();
      
      // Handle { scans: [...] } format or direct array
      const list = Array.isArray(data) ? data : (Array.isArray(data.scans) ? data.scans : []);
      
      return list;
    } catch (error) {
      console.error('Error listing scans:', error);
      return []; // Return empty array on failure to prevent frontend crashes
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
    const res = await fetch(`${API_BASE}/scans/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete scan');
  },

  async clearAllScans(): Promise<void> {
    const res = await fetch(`${API_BASE}/scans/clear`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear scans');
  }
};