export const DEFAULT_BACKUP_DOWNLOAD_DIR = '.openpass';
export const DEFAULT_BACKUP_LOCATION_LABEL = 'Downloads/.openpass';

export interface BackupDirectoryWriteResult {
  success: boolean;
  filename?: string;
  error?: string;
  needAuth?: boolean;
  locationLabel?: string;
  usesDefaultPath?: boolean;
}

export function createBackupFilename(encrypted: boolean): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = encrypted ? '-encrypted' : '';
  return `openpass-backup-${timestamp}${suffix}.json`;
}

export function getCustomBackupLocationLabel(directoryName: string, filename?: string): string {
  return filename ? `${directoryName}/${filename}` : directoryName;
}

export function getDefaultBackupLocationLabel(filename?: string): string {
  return filename ? `${DEFAULT_BACKUP_LOCATION_LABEL}/${filename}` : DEFAULT_BACKUP_LOCATION_LABEL;
}

function isEncryptedBackup(backupData: unknown): boolean {
  return typeof backupData === 'object' && backupData !== null && 'encrypted' in backupData &&
    (backupData as { encrypted?: boolean }).encrypted === true;
}

export async function writeBackupToDefaultDownloads(
  backupData: unknown
): Promise<BackupDirectoryWriteResult> {
  if (!chrome.downloads?.download) {
    return {
      success: false,
      error: '当前浏览器不支持默认目录备份，请选择自定义目录',
      needAuth: false,
      locationLabel: DEFAULT_BACKUP_LOCATION_LABEL,
      usesDefaultPath: true
    };
  }

  try {
    const filename = createBackupFilename(isEncryptedBackup(backupData));
    const content = JSON.stringify(backupData, null, 2);
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(content)}`;

    await chrome.downloads.download({
      url,
      filename: `${DEFAULT_BACKUP_DOWNLOAD_DIR}/${filename}`,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    return {
      success: true,
      filename,
      locationLabel: getDefaultBackupLocationLabel(filename),
      usesDefaultPath: true
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '写入默认备份目录失败',
      needAuth: false,
      locationLabel: DEFAULT_BACKUP_LOCATION_LABEL,
      usesDefaultPath: true
    };
  }
}
