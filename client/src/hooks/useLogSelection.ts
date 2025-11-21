import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InteractionLog, LogSummary } from '../../../shared/types';
import type { LogWithTime } from './useLogData';

// =============================================================================
// Hook
// =============================================================================

export interface UseLogSelectionParams {
  filteredLogs: LogWithTime[];
  filteredFileNames: string[];
  logsWithTime: LogWithTime[];
  fetchLogs: () => Promise<void>;
}

export interface UseLogSelectionReturn {
  // State
  selectedFileName: string | null;
  selectedLog: InteractionLog | null;
  detailError: string | null;
  isDetailLoading: boolean;
  selectedFiles: Set<string>;
  isDeleting: boolean;
  deleteError: string | null;
  isExporting: boolean;
  exportError: string | null;

  // Computed
  selectedCount: number;
  selectedSummary: LogSummary | null;
  selectedList: string[];
  hasSelection: boolean;
  selectedLogTimestamp: number | null;

  // Callbacks
  setSelectedFileName: (fileName: string | null) => void;
  toggleSelection: (fileName: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  handleDeleteSelected: () => Promise<void>;
  handleExportFiltered: () => Promise<void>;
}

export function useLogSelection({
  filteredLogs,
  filteredFileNames,
  logsWithTime,
  fetchLogs,
}: UseLogSelectionParams): UseLogSelectionReturn {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<InteractionLog | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const selectedCount = useMemo(() => selectedFiles.size, [selectedFiles]);
  const selectedSummary = useMemo(
    () => filteredLogs.find((entry) => entry.fileName === selectedFileName) ?? null,
    [filteredLogs, selectedFileName]
  );
  const selectedList = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const hasSelection = selectedCount > 0;

  const selectedLogTimestamp = useMemo(() => {
    if (!selectedFileName) {
      return null;
    }
    const entry = logsWithTime.find((log) => log.fileName === selectedFileName);
    return entry?.timestampMs ?? null;
  }, [selectedFileName, logsWithTime]);

  const toggleSelection = useCallback((fileName: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) {
        next.delete(fileName);
      } else {
        next.add(fileName);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles(() => new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(() => new Set(filteredLogs.map((entry) => entry.fileName)));
  }, [filteredLogs]);

  const fetchLogDetails = useCallback(async (fileName: string) => {
    setIsDetailLoading(true);
    try {
      const response = await fetch(`/api/logs/${encodeURIComponent(fileName)}`);
      if (!response.ok) {
        throw new Error(`Failed to load log details: ${response.statusText}`);
      }
      const data = (await response.json()) as InteractionLog;
      setSelectedLog(data);
      setDetailError(null);
    } catch (error) {
      console.error('[snoopty] fetchLogDetails error', error);
      setDetailError(error instanceof Error ? error.message : 'Unknown error loading details');
      setSelectedLog(null);
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedList.length === 0) {
      return;
    }
    const count = selectedList.length;
    const label =
      count === 1 ? 'the selected log' : `${count.toLocaleString()} selected logs`;
    const confirmed = window.confirm(
      `Delete ${label}? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setExportError(null);
    setIsDeleting(true);
    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileNames: selectedList }),
      });
      if (!response.ok) {
        throw new Error(`Failed to delete logs: ${response.statusText}`);
      }
      const data = (await response.json()) as {
        deleted: string[];
        failed: Array<{ fileName: string; error: string }>;
      };

      if (data.failed && data.failed.length > 0) {
        const names = data.failed.map((entry) => entry.fileName).join(', ');
        setDeleteError(`Failed to delete ${data.failed.length} entries: ${names}`);
      } else {
        setDeleteError(null);
      }

      setSelectedFiles((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        const next = new Set(prev);
        data.deleted.forEach((fileName) => next.delete(fileName));
        if (next.size === prev.size) {
          return prev;
        }
        return next;
      });

      await fetchLogs();
    } catch (error) {
      console.error('[snoopty] deleteSelected error', error);
      setDeleteError(error instanceof Error ? error.message : 'Unknown error deleting logs');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedList, fetchLogs]);

  const handleExportFiltered = useCallback(async () => {
    if (filteredFileNames.length === 0) {
      return;
    }
    setExportError(null);
    setIsExporting(true);
    try {
      const response = await fetch('/api/logs/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileNames: filteredFileNames }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let message = `Failed to export logs: ${response.statusText}`;
        try {
          if (contentType?.includes('application/json')) {
            const data = (await response.json()) as { error?: string };
            if (data?.error) {
              message = data.error;
            }
          } else {
            const text = await response.text();
            if (text) {
              message = text;
            }
          }
        } catch {
          // ignore secondary parsing errors
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      const match = disposition?.match(/filename="(.+?)"/);
      const filename = match ? match[1] : `snoopty-export-${Date.now()}.parquet`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      const missingHeader = response.headers.get('x-snoopty-missing');
      if (missingHeader) {
        try {
          const missing = JSON.parse(missingHeader) as string[];
          if (Array.isArray(missing) && missing.length > 0) {
            setExportError(`Export skipped ${missing.length} missing log(s): ${missing.join(', ')}`);
          }
        } catch {
          // ignore malformed header
        }
      } else {
        setExportError(null);
      }
    } catch (error) {
      console.error('[snoopty] exportFiltered error', error);
      setExportError(
        error instanceof Error ? error.message : 'Unknown error exporting logs'
      );
    } finally {
      setIsExporting(false);
    }
  }, [filteredFileNames]);

  // Clean up selections when filtered logs change
  useEffect(() => {
    setSelectedFiles((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const visible = new Set(filteredLogs.map((entry) => entry.fileName));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (visible.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [filteredLogs]);

  // Auto-select first log
  useEffect(() => {
    if (filteredLogs.length === 0) {
      if (selectedFileName !== null) {
        setSelectedFileName(null);
      }
      return;
    }
    if (!selectedFileName || !filteredLogs.some((entry) => entry.fileName === selectedFileName)) {
      setSelectedFileName(filteredLogs[0].fileName);
    }
  }, [filteredLogs, selectedFileName]);

  // Fetch details when selection changes
  useEffect(() => {
    if (selectedFileName) {
      fetchLogDetails(selectedFileName);
    } else {
      setSelectedLog(null);
    }
  }, [selectedFileName, fetchLogDetails]);

  return {
    selectedFileName,
    selectedLog,
    detailError,
    isDetailLoading,
    selectedFiles,
    isDeleting,
    deleteError,
    isExporting,
    exportError,
    selectedCount,
    selectedSummary,
    selectedList,
    hasSelection,
    selectedLogTimestamp,
    setSelectedFileName,
    toggleSelection,
    clearSelection,
    selectAll,
    handleDeleteSelected,
    handleExportFiltered,
  };
}
