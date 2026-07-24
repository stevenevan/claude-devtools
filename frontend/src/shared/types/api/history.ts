export interface HistoryEntry {
  display: string;
  project: string;
  timestamp: number;
  pastedCount: number;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  totalMatched: number;
  hasMore: boolean;
}
