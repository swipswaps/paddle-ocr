import React from 'react';
import { Scan } from '../types';

interface Props {
  scan: Scan;
  onClose: () => void;
  onDelete: (id: number) => void;
}

export const ScanDetailsModal: React.FC<Props> = ({ scan, onClose, onDelete }) => {
  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this scan?')) {
      onDelete(scan.id);
      onClose();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(scan.raw_text);
    alert('Text copied to clipboard!');
  };

  const handleDownload = () => {
    const blob = new Blob([scan.raw_text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scan.filename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content scan-details" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Details</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="scan-meta">
            <p><strong>File:</strong> {scan.filename}</p>
            <p><strong>Saved:</strong> {new Date(scan.created_at).toLocaleString()}</p>
            <p><strong>Size:</strong> {scan.raw_text.length} characters</p>
          </div>

          <div className="scan-actions">
            <button onClick={handleCopy} className="btn secondary">Copy Text</button>
            <button onClick={handleDownload} className="btn secondary">Download</button>
            <button onClick={handleDelete} className="btn danger">Delete</button>
          </div>

          <div className="raw-text-preview">
            <h3>Raw OCR Text</h3>
            <pre>{scan.raw_text}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};
