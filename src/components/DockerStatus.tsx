import React, { useEffect, useState, useRef } from 'react';
import { dockerHealthService } from '../services/dockerHealthService';
import { backendLogService } from '../services/backendLogService';
import { API_BASE } from '../config';
import { HealthStats } from '../types';

interface Process {
  pid: number;
  user: string;
  state: 'R' | 'S' | 'D' | 'Z';
  cpu: number;
  mem: number;
  timeMs: number;
  command: string;
}

export const DockerStatus: React.FC = () => {
  const [health, setHealth] = useState<HealthStats>({ status: 'offline' });
  const [showMonitor, setShowMonitor] = useState(false);
  
  // Track last log time to determine if stream is alive
  const lastLogTimeRef = useRef<number>(0);
  
  // Simulated Process List (Visual only, driven by real total stats)
  const [processes, setProcesses] = useState<Record<number, Process>>({
    1: { pid: 1, user: 'root', state: 'S', cpu: 0.0, mem: 0.0, timeMs: 0, command: 'python3 app.py' },
    22: { pid: 22, user: 'root', state: 'S', cpu: 0.0, mem: 0.0, timeMs: 0, command: 'paddle_worker' },
    35: { pid: 35, user: 'postgres', state: 'S', cpu: 0.0, mem: 0.0, timeMs: 0, command: 'postgres: main' },
  });

  const activeTimerRef = useRef<any>(null);

  useEffect(() => {
    // 1. Poll /health endpoint for Backend connectivity
    const check = async () => {
      const stats = await dockerHealthService.checkHealth();
      
      const now = Date.now();
      // Keep online if health check passes OR logs received recently
      const isStreamActive = (now - lastLogTimeRef.current) < 8000;
      const effectiveStatus = (stats.status === 'online' || isStreamActive) ? 'online' : 'offline';

      setHealth(prev => {
        // Update Process List Visualization
        const totalCpu = stats.cpu_percent || 0;
        const totalMem = stats.memory_used || 0;
        const memPercent = stats.memory_total ? (totalMem / stats.memory_total) * 100 : 0;

        // Visual logic: If CPU > 20%, worker is busy
        const isCrunching = totalCpu > 20;

        setProcesses(procs => ({
            ...procs,
            1: {
                ...procs[1],
                state: effectiveStatus === 'online' ? 'S' : 'Z',
                cpu: isCrunching ? totalCpu * 0.1 : totalCpu * 0.5,
                mem: memPercent * 0.1,
            },
            22: {
                ...procs[22],
                state: isCrunching ? 'R' : 'S',
                cpu: isCrunching ? totalCpu * 0.9 : 0, 
                mem: memPercent * 0.6, // Model takes RAM
            },
            35: {
                ...procs[35],
                cpu: 0.1,
                mem: memPercent * 0.1
            }
        }));

        return {
            ...prev,
            ...stats,
            status: effectiveStatus,
        };
      });
    };
    
    check();
    const interval = setInterval(check, 3000); 

    // 2. Listen to Log Stream for real metrics (faster updates)
    const unsubscribe = backendLogService.startStreaming((log) => {
      lastLogTimeRef.current = Date.now();
      
      if (!log || !log.msg) return;
      const msg = log.msg;

      // Parse [UTIL] logs from app.py
      if (msg.includes('[UTIL]')) {
          try {
             // Format: [UTIL] CPU/MEM/IO: 12.5% 150.5MiB / 2048.0MiB
             const parts = msg.split('CPU/MEM/IO:')[1].trim().split(/\s+/);
             if (parts.length >= 4) {
                const cpu = parseFloat(parts[0].replace('%', ''));
                const memUsed = parseFloat(parts[1].replace('MiB', ''));
                const memTotal = parseFloat(parts[3].replace('MiB', ''));
                
                setHealth(prev => ({
                    ...prev,
                    status: 'online',
                    cpu_percent: cpu,
                    memory_used: memUsed,
                    memory_total: memTotal
                }));
             }
          } catch(e) {
              // ignore parse error
          }
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  // Animation Loop for "TIME+" column
  useEffect(() => {
    activeTimerRef.current = setInterval(() => {
        setProcesses(prev => {
            const next = { ...prev };
            let hasChanges = false;
            Object.keys(next).forEach(key => {
                const k = Number(key);
                // Increment time if running
                if (next[k].state === 'R' || health.status === 'online') {
                    next[k] = { ...next[k], timeMs: next[k].timeMs + (next[k].state === 'R' ? 1000 : 100) };
                    hasChanges = true;
                }
            });
            return hasChanges ? next : prev;
        });
    }, 1000);
    return () => clearInterval(activeTimerRef.current);
  }, [health.status]);

  const isConnected = health.status === 'online';

  const toggleMonitor = () => {
    setShowMonitor(!showMonitor);
  };

  const getCpuColor = (percent: number) => {
    if (percent < 50) return '#28a745'; 
    if (percent < 80) return '#fd7e14'; 
    return '#dc3545'; 
  };

  const formatTimePlus = (ms: number) => {
      const seconds = Math.floor(ms / 1000);
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s.toString().padStart(2, '0')}.${Math.floor((ms % 1000) / 10)}`;
  };

  const cpuVal = health.cpu_percent || 0;
  const memUsed = health.memory_used || 0;
  const memTotal = health.memory_total || 2048;

  const renderTextBar = (percent: number, width: number = 20) => {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '|'.repeat(filled) + ' '.repeat(Math.max(0, empty));
  };

  return (
    <div style={{ position: 'relative', zIndex: 1000 }}>
      <div 
        className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}
        style={{ gap: '12px', paddingRight: '4px', cursor: 'pointer' }}
        onClick={toggleMonitor}
      >
        <div className="status-dot"></div>
        <span style={{ marginRight: '8px' }}>{isConnected ? 'System Ready' : 'Backend Offline'}</span>

        {isConnected && (
            <span style={{
                background: showMonitor ? '#ccc' : 'rgba(0,0,0,0.05)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                color: '#333'
            }}>
                📊 {cpuVal.toFixed(1)}%
            </span>
        )}
      </div>

      {showMonitor && (
        <div className="system-monitor-window" style={{
            position: 'absolute',
            top: '40px',
            right: '0',
            width: '320px',
            background: '#1e1e1e',
            border: '1px solid #444',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
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
                color: '#fff'
            }}>
              <span>Docker System Monitor</span>
              <span style={{cursor:'pointer'}} onClick={() => setShowMonitor(false)}>x</span>
            </div>
            
            {isConnected ? (
            <div style={{ padding: '8px' }}>
              <div style={{ marginBottom: '4px' }}>
                <span style={{ color: '#888' }}>CPU [</span>
                <span style={{ color: getCpuColor(cpuVal), fontWeight: 'bold' }}>
                  {renderTextBar(cpuVal, 20)}
                </span>
                <span style={{ color: '#888' }}>] {cpuVal.toFixed(1)}%</span>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#888' }}>MEM [</span>
                <span style={{ color: getCpuColor((memUsed/memTotal)*100), fontWeight: 'bold' }}>
                  {renderTextBar((memUsed/memTotal)*100, 20)}
                </span>
                <span style={{ color: '#888' }}>] {Math.round(memUsed)}M</span>
              </div>
              
              <div style={{ borderTop: '1px solid #444', margin: '4px 0' }}></div>

              <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', textAlign: 'right' }}>
                  <thead>
                      <tr style={{ color: '#888' }}>
                          <th style={{textAlign:'left'}}>PID</th>
                          <th>%CPU</th>
                          <th>%MEM</th>
                          <th>TIME+</th>
                          <th style={{textAlign:'left', paddingLeft:'4px'}}>CMD</th>
                      </tr>
                  </thead>
                  <tbody>
                      {Object.values(processes).map((proc: Process) => (
                          <tr key={proc.pid} style={{ color: proc.state === 'R' ? '#fff' : '#aaa' }}>
                              <td style={{textAlign:'left'}}>{proc.pid}</td>
                              <td>{proc.cpu.toFixed(1)}</td>
                              <td>{proc.mem.toFixed(1)}</td>
                              <td>{formatTimePlus(proc.timeMs)}</td>
                              <td style={{textAlign:'left', paddingLeft:'4px'}}>{proc.command}</td>
                          </tr>
                      ))}
                  </tbody>
              </table>
            </div>
            ) : (
             <div style={{ padding: '16px', textAlign: 'center', color: '#dc3545' }}>
                ⚠ Connection Failed
             </div>
            )}
        </div>
      )}
    </div>
  );
};