export interface OcrBlock {
  text: string;
  box: number[];
  confidence?: number;
}

export interface OcrResponse {
  text: string;
  raw_text?: string;
  blocks: OcrBlock[];
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
