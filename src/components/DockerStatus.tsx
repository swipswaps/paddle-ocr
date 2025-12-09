import React, { useEffect, useState, useRef } from 'react';
import { dockerHealthService } from '../services/dockerHealthService';
import { backendLogService } from '../services/backendLogService';
import { HealthStats } from '../types';

interface Process {
  pid: number;
  name: string;
  username: string;
  cpu_percent: number;
  memory_percent: number;
}

export const DockerStatus: React.FC = () => {
  const [health, setHealth] = useState<HealthStats>({ status: 'offline' });
  const [showMonitor, setShowMonitor] = useState(false);
  const [topProcs, setTopProcs] = useState<Process[]>([]);
  const [netRx, setNetRx] = useState(0);
  
  // Track last log time to determine if stream is active
  const lastLogTimeRef = useRef<number>(0);

  useEffect(() => {
    // 1. Poll /health endpoint for Backend connectivity and stats
    const check = async () => {
      const stats = await dockerHealthService.checkHealth();
      const now = Date.now();
      const isStreamActive = (now - lastLogTimeRef.current) < 10000;
      
      const effectiveStatus = (stats.status === 'online' || isStreamActive) ? 'online' : 'offline';

      setHealth(prev => ({
        ...prev,
        status: effectiveStatus,
        // Prefer polled stats, will fallback to log-streamed stats if undefined
        cpu_percent: stats.cpu_percent ?? prev.cpu_percent,
        memory_used: stats.memory_used ?? prev.memory_used,
        memory_total: stats.memory_total ?? prev.memory_total
      }));
    };
    
    check();
    const interval = setInterval(check, 2000); // Fast poll for responsiveness

    // 2. Listen to Log Stream for real-time metrics pushed by psutil
    const unsubscribe = backendLogService.startStreaming((log) => {
      lastLogTimeRef.current = Date.now();
      
      if (!log || !log.msg) return;
      const msg = log.msg;

      // Parse [METRIC] from app.py
      // Format: [METRIC] CPU: 12.5% RAM: 512/2048MB NET_RX: 120.5MB
      if (msg.includes('[METRIC]')) {
         const cpuMatch = msg.match(/CPU:\s*([\d.]+)%/);
         const ramMatch = msg.match(/RAM:\s*([\d.]+)\/([\d.]+)MB/);
         const netMatch = msg.match(/NET_RX:\s*([\d.]+)MB/);

         if (cpuMatch) {
             setHealth(prev => ({
                 ...prev,
                 status: 'online',
                 cpu_percent: parseFloat(cpuMatch[1]),
                 memory_used: ramMatch ? parseFloat(ramMatch[1]) : prev.memory_used,
                 memory_total: ramMatch ? parseFloat(ramMatch[2]) : prev.memory_total
             }));
         }
         if (netMatch) {
             setNetRx(parseFloat(netMatch[1]));
         }
      }

      // Parse [TOP] logs
      if (msg.includes('[TOP]')) {
          try {
              const jsonStr = msg.replace('[TOP] ', '');
              const procs = JSON.parse(jsonStr);
              setTopProcs(procs);
          } catch (e) {
              console.error("Failed to parse TOP log", e);
          }
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const isConnected = health.status === 'online';

  const toggleMonitor = () => {
    setShowMonitor(!showMonitor);
  };

  const getCpuColor = (percent: number = 0) => {
    if (percent < 50) return '#28a745'; 
    if (percent < 80) return '#fd7e14'; 
    return '#dc3545'; 
  };

  const cpuVal = health.cpu_percent ?? 0;
  const memUsed = health.memory_used ?? 0;
  const memTotal = health.memory_total || 2048;

  const renderTextBar = (percent: number, width: number = 20) => {
    const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
    const empty = width - filled;
    return '|'.repeat(filled) + ' '.repeat(empty);
  };

  return (
    <div style={{ position: 'relative', zIndex: 1000 }}>
      <div 
        className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}
        style={{ gap: '12px', paddingRight: '4px', cursor: 'pointer', userSelect: 'none' }}
        onClick={toggleMonitor}
      >
        <div className="status-dot"></div>
        <span style={{ marginRight: '8px' }}>{isConnected ? 'System Ready' : 'Backend Offline'}</span>

        {/* Real Stats Display */}
        <span style={{
            background: showMonitor ? '#ccc' : 'rgba(0,0,0,0.05)',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            color: '#333',
            display: 'flex',
            gap: '8px'
        }}>
            <span>CPU: {cpuVal.toFixed(1)}%</span>
            <span style={{ borderLeft: '1px solid #999', paddingLeft: '8px' }}>
                RAM: {Math.round(memUsed)}M
            </span>
        </span>
      </div>

      {showMonitor && (
        <div className="system-monitor-window" style={{
            position: 'absolute',
            top: '40px',
            right: '0',
            width: '450px',
            background: '#1e1e1e',
            border: '1px solid #444',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            color: '#ccc',
            overflow: 'hidden'
        }}>
            <div style={{
                background: '#333',
                padding: '4px 8px',
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid #444',
                fontWeight: 'bold',
                color: '#fff',
                userSelect: 'none'
            }}>
              <span>System Monitor (Real-time)</span>
              <span style={{cursor:'pointer'}} onClick={() => setShowMonitor(false)}>✕</span>
            </div>
            
            <div style={{ padding: '12px' }}>
              {/* CPU Bar */}
              <div style={{ marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                <span>CPU  [{renderTextBar(cpuVal, 25)}]</span>
                <span style={{ color: getCpuColor(cpuVal), fontWeight: 'bold' }}>{cpuVal.toFixed(1)}%</span>
              </div>
              {/* Memory Bar */}
              <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span>MEM  [{renderTextBar((memUsed/memTotal)*100, 25)}]</span>
                <span style={{ color: getCpuColor((memUsed/memTotal)*100), fontWeight: 'bold' }}>
                    {Math.round(memUsed)} / {Math.round(memTotal)} MB
                </span>
              </div>
              {/* Network I/O */}
              <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', color: '#85c4ff' }}>
                 <span>NET RX (Total)</span>
                 <span>{netRx.toFixed(1)} MB</span>
              </div>
              
              <div style={{ borderTop: '1px solid #444', margin: '8px 0' }}></div>

              {/* Process List Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                      <tr style={{ color: '#000', background: '#ccc' }}>
                          <th style={{padding: '2px'}}>PID</th>
                          <th>NAME</th>
                          <th>USER</th>
                          <th>%CPU</th>
                          <th>%MEM</th>
                      </tr>
                  </thead>
                  <tbody>
                      {topProcs.length === 0 ? (
                          <tr><td colSpan={5} style={{textAlign:'center', color: '#666', padding: '10px'}}>Collecting process data...</td></tr>
                      ) : (
                          topProcs.map((proc) => (
                              <tr key={proc.pid} style={{ borderBottom: '1px solid #333' }}>
                                  <td style={{color: '#aaa'}}>{proc.pid}</td>
                                  <td style={{color: '#fff'}}>{proc.name}</td>
                                  <td>{proc.username}</td>
                                  <td style={{color: getCpuColor(proc.cpu_percent)}}>{proc.cpu_percent.toFixed(1)}</td>
                                  <td>{proc.memory_percent.toFixed(1)}</td>
                              </tr>
                          ))
                      )}
                  </tbody>
              </table>
              
              <div style={{ marginTop: '8px', fontSize: '0.7rem', color: '#666', textAlign: 'center' }}>
                  Backend: Flask + Gunicorn | Engine: PaddleOCR
              </div>
            </div>
        </div>
      )}
    </div>
  );
};