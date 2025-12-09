import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ocrService } from './services/ocrService';
import { angleDetectionService } from './services/angleDetectionService';
import { DockerStatus } from './components/DockerStatus';
import { ScanDetailsModal } from './components/ScanDetailsModal';
import { OcrResponse, Scan } from './types';
import heic2any from 'heic2any';
import './App.css';

// Local interface for logs within App
interface LogEntry {
  type: 'system' | 'ocr' | 'error' | 'wait' | 'raw';
  message: string;
  timestamp: number;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // New state for showing text as it is found
  const [realtimeText, setRealtimeText] = useState<string>('');
  
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [resultViewMode, setResultViewMode] = useState<'text' | 'json'>('text'); // Toggle for result view
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  const refreshScans = useCallback(async () => {
    try {
      const data = await ocrService.listScans();
      // Ensure data is an array before setting state
      setScans(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load scans', e);
      setScans([]);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refreshScans();
  }, [refreshScans]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs]);

  const addLog = (message: string, type: 'system' | 'ocr' | 'error' | 'wait' | 'raw' = 'system', timestamp: number = Date.now()) => {
    setLogs(prev => [...prev, { type, message, timestamp }]);
  };

  const handleTabChange = (tab: 'upload' | 'history') => {
    setActiveTab(tab);
    if (tab === 'history') {
      refreshScans();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      let selectedFile = e.target.files[0];
      setLogs([]); 
      setRealtimeText('');
      setOcrResult(null);
      addLog(`Selected file: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`, 'system');

      if (selectedFile.name.toLowerCase().endsWith('.heic')) {
        addLog('Converting HEIC to JPEG...', 'system');
        try {
          const blob = await heic2any({ blob: selectedFile, toType: 'image/jpeg' });
          const convertedBlob = Array.isArray(blob) ? blob[0] : blob;
          selectedFile = new File([convertedBlob], selectedFile.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
          addLog('Conversion successful', 'system');
        } catch (error) {
          addLog('HEIC conversion failed', 'error');
          return;
        }
      }

      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsProcessing(true);
    setOcrResult(null);
    setRealtimeText('');
    
    let processedFile = file;
    try {
        processedFile = await angleDetectionService.autoCorrectRotation(file, (msg) => addLog(msg, 'system'));
    } catch (e) {
        addLog('Orientation check failed, using original', 'error');
    }

    // Keep track of streamed text in a local variable to merge later if needed
    let streamedContent = '';

    try {
      const result = await ocrService.processWithDocker(processedFile, (msg, ts) => {
        if (msg.startsWith('[STREAM_DATA]')) {
            const txt = msg.replace('[STREAM_DATA]', '').trim();
            const newText = txt + '\n';
            streamedContent += newText;
            setRealtimeText(prev => prev + newText);
            return;
        }

        let type: 'system' | 'ocr' | 'error' | 'wait' | 'raw' = 'system';
        if (msg.startsWith('[UI: WAITING]')) type = 'wait';
        else if (msg.startsWith('[RAW]')) type = 'raw';
        else if (msg.includes('[OCR INFO]') || msg.includes('rec_res')) type = 'ocr';
        else if (msg.toLowerCase().includes('error')) type = 'error';
        
        addLog(msg, type, ts);
      });

      // Reliability Fix: If result.raw_text is empty/missing but we streamed text, use the stream
      if ((!result.raw_text || result.raw_text.trim() === '') && streamedContent.trim().length > 0) {
          result.raw_text = streamedContent;
          addLog('[SYSTEM] Backend returned empty text, falling back to streamed content.', 'system');
      }

      setOcrResult(result);
      if (result.success) {
        addLog('OCR Processing Complete', 'system');
        // Refresh scans list silently so history is ready
        refreshScans();
      } else {
        addLog('OCR completed but marked as unsuccessful', 'error');
      }
    } catch (error: any) {
      addLog(`Error: ${error.message}`, 'error');
      // If we have partial text but failed, create a synthetic error result so user sees the text
      if (streamedContent.length > 0) {
          setOcrResult({
              success: false,
              raw_text: streamedContent,
              blocks: []
          });
          addLog('Restored partial text from stream despite error.', 'system');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleHistoryClick = (scan: Scan) => {
    setSelectedScan(scan);
  };

  const handleDeleteScan = async (id: number) => {
    try {
      await ocrService.deleteScan(id);
      refreshScans();
      if (selectedScan?.id === id) setSelectedScan(null);
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>PaddleOCR Scanner</h1>
        <DockerStatus />
      </header>

      <div className="tabs">
        <button 
          className={activeTab === 'upload' ? 'active' : ''} 
          onClick={() => handleTabChange('upload')}
        >
          New Scan
        </button>
        <button 
          className={activeTab === 'history' ? 'active' : ''} 
          onClick={() => handleTabChange('history')}
        >
          History ({scans.length})
        </button>
      </div>

      {activeTab === 'upload' && (
        <>
          <div className="upload-section">
            <div className="file-input-wrapper">
              <input type="file" onChange={handleFileChange} accept="image/*,.heic" disabled={isProcessing} />
              <p>Drag & drop an image here, or click to select</p>
              {file && <p><strong>Selected:</strong> {file.name}</p>}
            </div>

            <div className="preview-actions">
              <button 
                className="btn primary" 
                onClick={handleUpload} 
                disabled={!file || isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Extract Text'}
              </button>
            </div>
          </div>

          <div className="logs-panel">
            <h3>System Logs</h3>
            <div className="logs-content">
              {logs.length === 0 && <div className="log-entry system"><span className="log-msg">Ready...</span></div>}
              {logs.map((log, i) => (
                <div key={i} className={`log-entry ${log.type}`}>
                  <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Result Section - Always visible if we have data or are processing */}
          {(ocrResult || (isProcessing && realtimeText)) && (
            <div className="results-section">
                <div className="results-header">
                    <h3>{isProcessing ? 'Live Result' : 'Result'}</h3>
                    {!isProcessing && (
                      <div className="view-toggles">
                        <button 
                          className={`toggle-btn ${resultViewMode === 'text' ? 'active' : ''}`}
                          onClick={() => setResultViewMode('text')}
                        >
                          Text
                        </button>
                        <button 
                          className={`toggle-btn ${resultViewMode === 'json' ? 'active' : ''}`}
                          onClick={() => setResultViewMode('json')}
                        >
                          JSON Data
                        </button>
                      </div>
                    )}
                </div>
                
                {resultViewMode === 'text' ? (
                   <textarea 
                      className="ocr-output" 
                      readOnly 
                      value={isProcessing ? realtimeText : (ocrResult?.raw_text || '')}
                      rows={15}
                      placeholder="Recognized text..."
                   />
                ) : (
                   <textarea 
                      className="ocr-output json" 
                      readOnly 
                      value={JSON.stringify(ocrResult, null, 2)}
                      rows={15}
                   />
                )}
            </div>
          )}
        </>
      )}

      {activeTab === 'history' && (
        <div className="history-section">
            <div className="history-header">
                <h3>Saved Scans</h3>
                <button className="btn secondary" onClick={refreshScans}>Refresh</button>
            </div>
            <div className="scans-grid">
                {scans.map(scan => (
                    <div key={scan.id} className="scan-card" onClick={() => handleHistoryClick(scan)}>
                        <h4>{scan.filename}</h4>
                        <p>{scan.created_at ? new Date(scan.created_at).toLocaleDateString() : 'Unknown Date'}</p>
                        <p>{(scan.raw_text || '').substring(0, 50)}...</p>
                    </div>
                ))}
                {scans.length === 0 && <p>No scans saved yet.</p>}
            </div>
        </div>
      )}

      {selectedScan && (
        <ScanDetailsModal 
            scan={selectedScan} 
            onClose={() => setSelectedScan(null)} 
            onDelete={handleDeleteScan}
        />
      )}
    </div>
  );
}

export default App;