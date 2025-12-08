import { API_BASE } from '../config';
import { HealthStats } from '../types';

class DockerHealthService {
  // Logic to pause monitoring is removed because the backend is now threaded (Issue #27).
  // We WANT to monitor health/cpu during heavy OCR tasks to show load.

  async checkHealth(): Promise<HealthStats> {
    try {
      const controller = new AbortController();
      // Short timeout because health checks should be fast
      const id = setTimeout(() => controller.abort(), 2000); 
      
      const res = await fetch(`${API_BASE}/health`, { 
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(id);
      
      if (res.ok) {
        try {
          // Attempt to parse rich stats if backend provides them
          const data = await res.json();
          return {
            status: 'online',
            cpu_percent: data.cpu_percent,
            memory_used: data.memory_used,
            memory_total: data.memory_total
          };
        } catch (e) {
          // Fallback for simple 200 OK without JSON
          return { status: 'online' };
        }
      }
      
      return { status: 'offline' };
    } catch (e) {
      return { status: 'offline' };
    }
  }
}

export const dockerHealthService = new DockerHealthService();