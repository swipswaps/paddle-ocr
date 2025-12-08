
export interface OcrBlock {
  text: string;
  box: number[];
  confidence?: number;
}

export interface OcrResponse {
  // Core fields from backend
  success?: boolean;
  filename?: string;
  layout?: {
    columns?: number;
    rows?: number;
    gap_size?: number;
    [key: string]: any;
  };
  parsed?: string;
  raw_text?: string;
  blocks: OcrBlock[];
  
  // Legacy/Computed fields
  text?: string; 
  column_count?: number;
  row_count?: number;
}

export interface Scan {
  id: number;
  filename: string;
  raw_text: string;
  created_at: string;
}

export interface BackendLogEntry {
  ts: number;
  msg: string;
}
