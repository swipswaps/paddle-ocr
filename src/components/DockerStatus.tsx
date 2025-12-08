import React, { useEffect, useState } from 'react';
import { dockerHealthService } from '../services/dockerHealthService';
import { API_BASE } from '../config';

export const DockerStatus: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const check = async () => {
      const healthy = await dockerHealthService.checkHealth();
      setIsConnected(healthy);
    };
    
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <div 
        className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}
        onClick={() => !isConnected && setShowHelp(!showHelp)}
        style={{ cursor: isConnected ? 'default' : 'pointer' }}
        title={isConnected ? `Connected to ${API_BASE}` : `Offline - Checked ${API_BASE}`}
      >
        <div className="status-dot"></div>
        <span>{isConnected ? 'System Ready' : 'Backend Offline'}</span>
      </div>

      {showHelp && !isConnected && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          background: 'white',
          border: '1px solid #ccc',
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          width: '300px',
          marginTop: '8px',
          zIndex: 100,
          fontSize: '0.85rem'
        }}>
          <strong>Troubleshooting:</strong>
          <p style={{margin: '8px 0', fontSize: '0.8rem', color: '#666'}}>
            Trying to connect to: <br/><code>{API_BASE}</code>
          </p>
          <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>
            <li>Ensure Docker is running on port 5001</li>
            <li>If on phone, ensure PC firewall allows port 5001</li>
            <li>Check if backend script is running</li>
          </ul>
          <button 
            className="btn secondary" 
            style={{ width: '100%', padding: '4px', fontSize: '0.8rem' }}
            onClick={() => setShowHelp(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};
