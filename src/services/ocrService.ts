import { API_BASE } from '../config';
import { OcrResponse, Scan, BackendLogEntry } from '../types';
import { backendLogService } from './backendLogService';
// dockerHealthService import kept for consistency if needed later, but usage removed

export const ocrService = {
  async processWithDocker(
    file: File, 
    onLog?: (msg: string, ts?: number) => void
  ): Promise<OcrResponse> {
    
    // NOTE: We no longer pause health checks here.
    // Since the backend is threaded, we want to poll /health to see CPU usage 
    // spike during the OCR process.
    
    let lastLogTime = Date.now();
    let currentPhase = 'init'; // init, uploading, processing, detecting, recognizing, complete

    // HEURISTIC: Inject reassuring status updates if the backend is silent.
    const heartbeatInterval = setInterval(() => {
        const now = Date.now();
        const silenceDuration = now - lastLogTime;
        
        // Trigger if silent for > 3s AND we are in a busy phase (processing or detecting)
        if (silenceDuration > 3000 && (currentPhase === 'detecting' || currentPhase === 'processing')) {
             let messages = [
                 "Engine is crunching data...",
                 "Holding tight...",
                 "Still working on it..."
             ];

             if (currentPhase === 'detecting') {
                 messages = [
                     "Analyzing complex image patterns...",
                     "Identifying potential text lines...",
                     "Refining bounding box coordinates...",
                     "Filtering non-text elements...",
                     "Mapping text density..."
                 ];
             } else if (currentPhase === 'processing') {
                 // Post-upload, pre-detection (Model loading or preprocessing)
                 messages = [
                     "Warming up OCR engine...",
                     "Loading image into memory...",
                     "Preprocessing image filters...",
                     "Initializing neural network..."
                 ];
             }

             // Cycle through messages
             const msgIndex = Math.floor((now / 3000) % messages.length);
             const msg = messages[msgIndex];
             
             // Use specific tag [UI: WAITING] to distinguish from real logs
             onLog?.(`[UI: WAITING] ${msg}`, now);
             lastLogTime = now; // Reset timer so we don't spam
        }
    }, 1000);
    
    // Start streaming logs
    const stopLogging = backendLogService.startStreaming((log) => {
        if (!log || !log.msg) return;

        lastLogTime = Date.now(); // Reset watchdog on meaningful log
        const timestamp = log.ts ? log.ts * 1000 : Date.now();
        const msg = log.msg;

        // Phase Detection
        if (msg.includes('Step 1/3')) currentPhase = 'detecting';
        if (msg.includes('Step 2/3')) currentPhase = 'recognizing';
        if (msg.includes('Success: True')) currentPhase = 'complete';

        // INTERPRETIVE LAYER: Parse known PaddleOCR/Backend patterns
        // 1. Image Geometry
        if (msg.includes('image shape:')) {
             onLog?.(`[OCR INFO] 📏 Image Dimensions: ${msg.split('shape:')[1].trim()}`, Date.now());
        }

        // 2. Detection Phase Data (Step 1)
        if (msg.includes('dt_boxes num')) {
            const match = msg.match(/dt_boxes num\s*:\s*(\d+)/);
            if (match) {
                onLog?.(`[OCR INFO] 🔍 Text Detection: Found ${match[1]} regions`, Date.now());
            }
        }

        // 3. Recognition Phase Data (Step 2) - Real-time text streaming
        // Python tuple output can vary: rec_res: ('Text', 0.99) or ("Text", 0.99)
        if (msg.includes('rec_res')) {
            // Permissive regex to capture text in quotes and confidence score
            const match = msg.match(/rec_res:.*?\(["'](.*?)["'],\s*([0-9.]+)\)/);
            
            if (match && match[1]) {
                const txt = match[1];
                const score = match[2] ? Math.round(parseFloat(match[2]) * 100) : '?';
                
                // Emit special stream data for UI typewriter effect
                onLog?.(`[STREAM_DATA] ${txt}`, Date.now()); 
                // Log readable info to panel
                onLog?.(`[OCR INFO] 📖 Recognized: "${txt}" (${score}%)`, Date.now());
                return; 
            }
        }

        // Pass through everything else
        onLog?.(msg, timestamp);
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const data = await new Promise<OcrResponse>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${API_BASE}/ocr`);
          
          // SET TIMEOUT to 3 minutes (180,000 ms)
          xhr.timeout = 180000;

          // Track Upload Progress (Client -> Server)
          xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                  const percent = Math.round((event.loaded / event.total) * 100);
                  const loadedMB = (event.loaded / (1024 * 1024)).toFixed(2);
                  const totalMB = (event.total / (1024 * 1024)).toFixed(2);
                  
                  // Update heartbeat timer only if we actually log something or state changes
                  if (percent === 100) {
                      currentPhase = 'processing'; // Switch phase immediately
                      onLog?.(`[SYSTEM] Upload complete. Waiting for server response...`, Date.now());
                      lastLogTime = Date.now();
                  } else if (percent === 0 || percent % 10 === 0) {
                      onLog?.(`[SYSTEM] Uploading... ${percent}% (${loadedMB} / ${totalMB} MB)`, Date.now());
                      lastLogTime = Date.now();
                  }
                  
                  if (currentPhase === 'init') currentPhase = 'uploading';
              }
          };

          // Track Download Progress (Server -> Client)
          xhr.onprogress = (event) => {
               if (event.loaded > 0) {
                   // Only log significant chunks to avoid spam
                   if (event.loaded < 1024 || event.loaded % (1024 * 100) === 0) {
                       onLog?.(`[SYSTEM] Receiving response data... (${(event.loaded / 1024).toFixed(1)} KB)`, Date.now());
                       lastLogTime = Date.now(); // Reset only when we tell the user something
                   }
               }
          };

          xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                      resolve(JSON.parse(xhr.responseText));
                  } catch (e) {
                      reject(new Error('Invalid JSON response from server'));
                  }
              } else {
                  reject(new Error(`Backend error: ${xhr.status} ${xhr.statusText}`));
              }
          };

          xhr.ontimeout = () => {
              reject(new Error('Request timed out. The backend server took too long to respond (3 mins).'));
          };

          xhr.onerror = () => reject(new Error('Network request failed'));
          
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          onLog?.(`[SYSTEM] Initializing upload of ${file.name} (${sizeMB} MB)...`, Date.now());
          currentPhase = 'uploading';
          xhr.send(formData);
      });

      // Detailed response logging
      onLog?.('--- OCR Task Complete ---', Date.now());
      onLog?.(`Success: ${data.success ? 'True' : 'False'}`, Date.now());
      
      if (data.layout) {
        onLog?.(`Structure: ${data.layout.columns || '?'} columns, ${data.layout.rows || '?'} rows`, Date.now());
      }
      if (data.blocks) {
        onLog?.(`Blocks: ${data.blocks.length} text blocks identified`, Date.now());
      }
      
      onLog?.('-------------------------', Date.now());

      return data;
    } finally {
      clearInterval(heartbeatInterval);
      stopLogging();
      // Resume logic removed as it's no longer needed
    }
  },

  async listScans(): Promise<Scan[]> {
    try {
      const res = await fetch(`${API_BASE}/scans`);
      if (!res.ok) throw new Error('Failed to fetch scans');
      
      const data = await res.json();
      
      if (data && Array.isArray(data.scans)) return data.scans;
      if (Array.isArray(data)) return data;
      
      console.warn('Unexpected scan list format:', data);
      return [];
    } catch (error) {
      console.error('Error listing scans:', error);
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
    const res = await fetch(`${API_BASE}/scans/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete scan');
  },

  async clearAllScans(): Promise<void> {
    const res = await fetch(`${API_BASE}/scans/clear`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear scans');
  }
};