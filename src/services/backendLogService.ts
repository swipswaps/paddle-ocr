import { API_BASE } from '../config';
import { BackendLogEntry } from '../types';

export const backendLogService = {
  startStreaming(onLog: (entry: BackendLogEntry) => void): () => void {
    const eventSource = new EventSource(`${API_BASE}/logs/stream`);
    
    eventSource.onmessage = (event) => {
      // Skip empty events
      if (!event.data) return;

      try {
        const data = JSON.parse(event.data);
        
        // Normalize the log entry. Backend might send 'msg', 'message', 'stdout', etc.
        let msg = '';
        let ts = Date.now() / 1000;

        if (typeof data === 'string') {
          msg = data;
        } else if (typeof data === 'object' && data !== null) {
          // Check extensive list of potential fields to ensure nothing is hidden
          msg = data.msg || 
                data.message || 
                data.log || 
                data.content || 
                data.stdout || 
                data.stderr || 
                '';
          
          // If we have a 'level' (e.g. INFO, WARN), prepend it to match standard logs
          if (data.level && msg) {
             msg = `[${data.level}] ${msg}`;
          }

          // If msg is still empty/undefined but we have an object, stringify it
          if (!msg && Object.keys(data).length > 0) {
            msg = JSON.stringify(data);
          }
          
          if (data.ts) ts = data.ts;
        } else {
          msg = String(data);
        }

        // Only trigger callback if we extracted a message
        if (msg) {
          onLog({ ts, msg });
        }
      } catch (e) {
        // If JSON parse fails, treat the raw data as the message if it's not whitespace
        if (event.data.trim()) {
           onLog({
             ts: Date.now() / 1000,
             msg: event.data
           });
        }
      }
    };

    eventSource.onerror = () => {
      // Quietly close on error to avoid spamming connection retries if server goes down
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }
};