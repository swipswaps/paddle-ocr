import { API_BASE } from '../config';

class DockerHealthService {
  private isMonitoring = true;

  pauseMonitoring() {
    this.isMonitoring = false;
  }

  resumeMonitoring() {
    this.isMonitoring = true;
  }

  async checkHealth(): Promise<boolean> {
    if (!this.isMonitoring) return true; // Assume healthy if busy processing
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2s timeout
      
      const res = await fetch(`${API_BASE}/health`, { 
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(id);
      return res.ok;
    } catch (e) {
      return false;
    }
  }
}

export const dockerHealthService = new DockerHealthService();
