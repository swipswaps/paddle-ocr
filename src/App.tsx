import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ocrService } from './services/ocrService';
import { angleDetectionService } from './services/angleDetectionService';
import { systemLogger, LogEntry } from './services/systemLogger';
import { DockerStatus } from './components/DockerStatus';
import { ScanDetailsModal } from './components/ScanDetailsModal';
import { OcrResponse, Scan } from './types';
import heic2any from 'heic2any';
import './App.css';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const refreshScans = useCallback(async () => {
    try {
      const data = await ocrService.listScans();
      setScans(data);
    } catch (e) {
      console.error(e);
      setScans([]);
    }
  }, []);

  useEffect(() => {
    refreshScans();
    // System log listener
    const cleanup = systemLogger.addListener((log) => {
        // Skip data URL logs to prevent memory issues
        if (log.message && typeof log.message === 'string' && !log.message.includes('data:image')) {
             setLogs(prev => [...prev.slice(-199), log]);
        }
    });
    return cleanup;
  }, [refreshScans]);

  useEffect(() => {
    // Auto-scroll logs
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setLogs([]); // Clear logs on new file
      setOcrResult(null); // Clear previous result
      
      const sizeMb = (selectedFile.size / (1024 * 1024)).toFixed(2);
      systemLogger.info('system', `Selected: ${selectedFile.name} (${sizeMb} MB)`);
      
      // HEIC Preprocessing
      if (selectedFile.name.toLowerCase().endsWith('.heic')) {
          systemLogger.info('system', 'Detected HEIC image, converting to JPEG...');
          try {
              const converted = await heic2any({ blob: selectedFile, toType: 'image/jpeg' });
              const jpgFile = new File(
                  [Array.isArray(converted) ? converted[0] : converted], 
                  selectedFile.name.replace(/\.heic$/i, '.jpg'),
                  { type: 'image/jpeg' }
              );
              setFile(jpgFile);
              systemLogger.info('system', 'HEIC converted (ready for processing)');
          } catch (err) {
              systemLogger.error('system', 'HEIC conversion failed');
          }
      }
    }
  };

  const processImage = async () => {
    if (!file) return;
    setIsProcessing(true);
    setOcrResult(null); // Reset result
    
    try {
      // Auto-rotate with granular logging
      const rotatedFile = await angleDetectionService.autoCorrectRotation(file, (msg) => {
        systemLogger.info('system', msg);
      });
      
      // Process with Docker
      const result = await ocrService.processWithDocker(rotatedFile, (msg, ts) => {
          // Log verbatim, passing the backend timestamp if available
          systemLogger.info('ocr', msg, ts);
      });
      
      setOcrResult(result);
    } catch (e) {
      systemLogger.error('error', `Processing failed: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveScan = async () => {
      // Use parsed, raw_text or text, falling back to empty string
      const textToSave = ocrResult?.parsed || ocrResult?.text || ocrResult?.raw_text || '';
      
      if (file && textToSave) {
          try {
              await ocrService.saveScan(file.name, textToSave);
              alert('Scan saved!');
              refreshScans();
          } catch (e) {
              alert('Failed to save scan');
              systemLogger.error('error', 'Failed to save scan to database');
          }
      } else {
        alert('No text to save!');
      }
  };

  const handleClearHistory = async () => {
      if(window.confirm("Clear all scan history?")) {
          await ocrService.clearAllScans();
          refreshScans();
      }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  };

  // Safe accessor for display text - prioritize 'parsed' then 'text' then 'raw_text'
  const displayText = ocrResult ? (ocrResult.parsed || ocrResult.text || ocrResult.raw_text || '') : '';

  return (
    <div className="app-container">
      <header>
        <h1>PaddleOCR App</h1>
        <DockerStatus />
      </header>

      <div className="tabs">
        <button 
            className={activeTab === 'upload' ? 'active' : ''} 
            onClick={() => setActiveTab('upload')}
        >
            New Scan
        </button>
        <button 
            className={activeTab === 'history' ? 'active' : ''} 
            onClick={() => setActiveTab('history')}
        >
            History ({scans.length})
        </button>
      </div>

      <main>
        {activeTab === 'upload' ? (
            <div className="upload-section">
                <div className="file-input-wrapper">
                    <input type="file" onChange={handleFileSelect} accept=".jpg,.png,.jpeg,.heic" />
                    <p>Drop image or click to upload</p>
                </div>
                
                {file && (
                    <div className="preview-actions">
                        <p>Selected: {file.name}</p>
                        <button 
                            className="btn primary" 
                            onClick={processImage} 
                            disabled={isProcessing}
                        >
                            {isProcessing ? 'Processing...' : 'Extract Text'}
                        </button>
                    </div>
                )}

                <div className="logs-panel">
                    <h3>System Logs</h3>
                    <div className="logs-content">
                        {logs.map((log, i) => (
                            <div key={i} className={`log-entry ${log.type}`}>
                                <span className="log-time">{formatTime(log.timestamp)}</span>
                                <span className="log-msg">{log.message}</span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>

                {displayText && (
                    <div className="results-section">
                        <div className="results-header">
                            <h2>Result</h2>
                            <button className="btn secondary" onClick={handleSaveScan}>Save to Database</button>
                        </div>
                        <textarea readOnly value={displayText} rows={20} className="ocr-output" />
                    </div>
                )}
            </div>
        ) : (
            <div className="history-section">
                <div className="history-header">
                    <h2>Saved Scans</h2>
                    <button className="btn danger" onClick={handleClearHistory}>Clear All</button>
                </div>
                {(!scans || scans.length === 0) ? <p>No scans saved yet.</p> : (
                    <div className="scans-grid">
                        {scans.map(scan => (
                            <div key={scan.id} className="scan-card" onClick={() => setSelectedScan(scan)}>
                                <h4>{scan.filename}</h4>
                                <p>{new Date(scan.created_at).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}
      </main>

      {selectedScan && (
          <ScanDetailsModal 
              scan={selectedScan} 
              onClose={() => setSelectedScan(null)}
              onDelete={async (id) => {
                  await ocrService.deleteScan(id);
                  refreshScans();
              }}
          />
      )}
    </div>
  );
}

export default App;