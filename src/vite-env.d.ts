/// <reference types="vite/client" />

interface FileSystemHandle {
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

interface Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
