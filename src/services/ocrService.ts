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

      // Log actual file details instead of a generic timer
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      onLog?.(`[SYSTEM] Uploading ${file.name} (${sizeMB} MB)...`, Date.now());
      onLog?.('[SYSTEM] Handing off to PaddleOCR backend. Please wait for server logs...', Date.now());
      
      const response = await fetch(`${API_BASE}/ocr`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data: OcrResponse = await response.json();
      
      // Detailed response logging based on user request
      onLog?.('--- OCR Result Details ---', Date.now());
      onLog?.(`Success: ${data.success ? 'True' : 'False'}`, Date.now());
      
      if (data.filename) onLog?.(`Filename: ${data.filename}`, Date.now());
      
      if (data.layout) {
        const layoutStr = JSON.stringify(data.layout, null, 0)
          .replace(/["{}]/g, '')
          .replace(/,/g, ', ');
        onLog?.(`Layout Analysis: ${layoutStr}`, Date.now());
      } else {
        // Fallback for older backend versions
        const cols = data.column_count || 1;
        const rows = data.row_count || (data.blocks ? data.blocks.length : 0);
        onLog?.(`Layout Analysis: ${cols} columns, ${rows} rows`, Date.now());
      }

      if (data.blocks) {
        onLog?.(`Text Blocks Detected: ${data.blocks.length}`, Date.now());
      }

      if (data.parsed) {
        onLog?.(`Parsed Text: ${data.parsed.length} characters`, Date.now());
      }
      
      if (data.raw_text && (!data.parsed || data.parsed.length !== data.raw_text.length)) {
        onLog?.(`Raw Text: ${data.raw_text.length} characters`, Date.now());
      }
      
      onLog?.('--------------------------', Date.now());

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
      if (data && Array.isArray(data.scans)) {
          return data.scans;
      }
      if (Array.isArray(data)) {
          return data;
      }
      
      console.warn('Unexpected scan list format:', data);
      return [];
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