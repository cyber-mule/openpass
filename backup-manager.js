/**
 * OpenPass - 备份管理模块
 * 处理备份导出、导入、版本兼容和数据迁移
 */

class BackupManager {
  constructor() {
    // 当前应用版本
    this.appVersion = this.getAppVersion();
    // 当前备份格式版本
    this.formatVersion = 1;
    // 支持的最低次版本（用于向后兼容）
    this.minSupportedMinorVersion = -1; // 支持前一个次版本
  }

  /**
   * 获取应用版本
   */
  getAppVersion() {
    const manifest = chrome.runtime.getManifest();
    return manifest.version || '0.0.0';
  }

  /**
   * 解析版本号
   * @param {string} version - 版本字符串，如 "0.1.0"
   * @returns {{major: number, minor: number, patch: number}}
   */
  parseVersion(version) {
    const parts = (version || '0.0.0').split('.').map(Number);
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    };
  }

  /**
   * 比较版本号
   * @returns {-1 | 0 | 1} - -1: v1 < v2, 0: v1 == v2, 1: v1 > v2
   */
  compareVersions(v1, v2) {
    const p1 = this.parseVersion(v1);
    const p2 = this.parseVersion(v2);

    if (p1.major !== p2.major) return p1.major < p2.major ? -1 : 1;
    if (p1.minor !== p2.minor) return p1.minor < p2.minor ? -1 : 1;
    if (p1.patch !== p2.patch) return p1.patch < p2.patch ? -1 : 1;
    return 0;
  }

  /**
   * 检查版本兼容性
   * 规则：x.y.z 可以导入 x.(y-1).* 和 x.y.* 的备份
   * @param {string} backupVersion - 备份的应用版本
   * @returns {{compatible: boolean, message: string, level: 'ok'|'warning'|'error'}}
   */
  checkCompatibility(backupVersion) {
    const current = this.parseVersion(this.appVersion);
    const backup = this.parseVersion(backupVersion);

    // 主版本不同，不兼容
    if (current.major !== backup.major) {
      return {
        compatible: false,
        message: `备份版本 ${backupVersion} 与当前版本 ${this.appVersion} 主版本不兼容`,
        level: 'error'
      };
    }

    // 次版本差距
    const minorDiff = current.minor - backup.minor;

    if (minorDiff < 0) {
      // 备份版本更高
      return {
        compatible: false,
        message: `备份版本 ${backupVersion} 高于当前版本 ${this.appVersion}，请升级应用`,
        level: 'error'
      };
    } else if (minorDiff === 0) {
      // 同一次版本，完全兼容
      return {
        compatible: true,
        message: `备份版本 ${backupVersion} 与当前版本完全兼容`,
        level: 'ok'
      };
    } else if (minorDiff === 1) {
      // 前一个次版本，兼容但可能需要迁移
      return {
        compatible: true,
        message: `备份版本 ${backupVersion} 可导入，数据将自动迁移到 ${this.appVersion}`,
        level: 'warning'
      };
    } else {
      // 跨度太大，不兼容
      return {
        compatible: false,
        message: `备份版本 ${backupVersion} 过旧，不支持跨多个版本导入（当前 ${this.appVersion}）`,
        level: 'error'
      };
    }
  }

  /**
   * 创建备份数据
   * @param {Array} secrets - 密钥列表
   * @param {Object} options - 附加选项
   */
  createBackup(secrets, options = {}) {
    const backup = {
      // 备份格式信息
      format: 'openpass-backup',
      formatVersion: this.formatVersion,

      // 应用版本信息
      appVersion: this.appVersion,

      // 导出信息
      exportTime: new Date().toISOString(),
      exportPlatform: navigator.platform,
      exportUserAgent: navigator.userAgent,

      // 数据统计
      count: secrets.length,
      encrypted: options.encrypted || false,

      // 密钥数据
      secrets: secrets
    };

    // 如果有加密，添加加密信息
    if (options.encrypted) {
      backup.encryptionVersion = options.encryptionVersion || 1;
      backup.kdf = options.kdf || 'PBKDF2';
      backup.kdfIterations = options.kdfIterations || 100000;
    }

    return backup;
  }

  /**
   * 验证备份数据格式
   * @param {Object} data - 备份数据
   * @returns {{valid: boolean, error?: string, data?: Object}}
   */
  validateBackup(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: '无效的备份文件' };
    }

    // 检查格式标识
    if (data.format === 'openpass-backup') {
      // 新格式
      if (typeof data.formatVersion !== 'number') {
        return { valid: false, error: '缺少格式版本号' };
      }
      if (!Array.isArray(data.secrets)) {
        return { valid: false, error: '缺少密钥数据' };
      }
    } else if (data.version === '2.0' || data.version === '1.0') {
      // 旧格式兼容 (totppass-backup)
      if (!Array.isArray(data.secrets)) {
        return { valid: false, error: '缺少密钥数据' };
      }
      // 转换为新格式
      data = this.migrateFromLegacy(data);
    } else if (Array.isArray(data)) {
      // 最简格式：直接是数组
      data = {
        format: 'openpass-backup',
        formatVersion: 0,
        appVersion: '0.0.0',
        secrets: data
      };
    } else if (Array.isArray(data.secrets)) {
      // 兼容其他包含 secrets 字段的格式
      data = {
        format: 'openpass-backup',
        formatVersion: 0,
        appVersion: data.appVersion || '0.0.0',
        secrets: data.secrets
      };
    } else {
      return { valid: false, error: '无法识别的备份格式' };
    }

    // 验证每个密钥
    for (let i = 0; i < data.secrets.length; i++) {
      const secret = data.secrets[i];
      if (!secret.secret || !secret.site) {
        return { valid: false, error: `第 ${i + 1} 个密钥数据不完整` };
      }
      if (typeof secret.secret !== 'string' || typeof secret.site !== 'string') {
        return { valid: false, error: `第 ${i + 1} 个密钥数据格式错误` };
      }
    }

    return { valid: true, data };
  }

  /**
   * 从旧格式迁移
   */
  migrateFromLegacy(data) {
    return {
      format: 'openpass-backup',
      formatVersion: 1,
      appVersion: data.version === '2.0' ? '0.1.0' : '0.0.0',
      exportTime: data.exportTime || new Date().toISOString(),
      count: data.count || data.secrets.length,
      encrypted: data.encrypted || false,
      secrets: data.secrets
    };
  }

  /**
   * 迁移备份数据到当前版本
   * @param {Object} data - 备份数据
   * @returns {Object} - 迁移后的数据
   */
  migrateData(data) {
    const fromVersion = data.appVersion;
    const toVersion = this.appVersion;

    // 如果版本相同，无需迁移
    if (fromVersion === toVersion) {
      return data;
    }

    const from = this.parseVersion(fromVersion);
    const to = this.parseVersion(toVersion);

    // 创建迁移后的数据副本
    let migrated = JSON.parse(JSON.stringify(data));
    migrated.migratedFrom = fromVersion;
    migrated.migratedAt = new Date().toISOString();
    migrated.appVersion = toVersion;

    // 执行版本迁移链
    // 例如：从 0.1.x 迁移到 0.2.x
    if (from.major === 0 && from.minor === 0 && to.minor >= 1) {
      migrated = this.migrate_0_0_to_0_1(migrated);
    }
    if (from.major === 0 && from.minor === 1 && to.minor >= 2) {
      migrated = this.migrate_0_1_to_0_2(migrated);
    }

    // 更新格式版本
    migrated.formatVersion = this.formatVersion;

    return migrated;
  }

  /**
   * 迁移：0.0.x -> 0.1.x
   * 示例：添加新字段、修改数据结构等
   */
  migrate_0_0_to_0_1(data) {
    // 为每个密钥添加新字段（如果需要）
    data.secrets = data.secrets.map(secret => ({
      ...secret,
      // 确保 digits 字段存在
      digits: secret.digits || 6,
      // 添加创建时间（如果没有）
      createdAt: secret.createdAt || secret.importedAt || new Date().toISOString()
    }));

    return data;
  }

  /**
   * 迁移：0.1.x -> 0.2.x
   * 示例：未来的迁移逻辑
   */
  migrate_0_1_to_0_2(data) {
    // 预留：未来的迁移逻辑
    // data.secrets = data.secrets.map(secret => ({
    //   ...secret,
    //   // 新字段
    // }));

    return data;
  }

  /**
   * 获取备份摘要信息
   */
  getBackupSummary(data) {
    return {
      format: data.format,
      formatVersion: data.formatVersion,
      appVersion: data.appVersion,
      exportTime: data.exportTime,
      count: data.count || data.secrets?.length || 0,
      encrypted: data.encrypted || false,
      compatibility: this.checkCompatibility(data.appVersion || '0.0.0')
    };
  }

  /**
   * 格式化版本信息显示
   */
  formatVersionInfo(data) {
    const summary = this.getBackupSummary(data);
    const exportDate = summary.exportTime
      ? new Date(summary.exportTime).toLocaleString('zh-CN')
      : '未知';

    return {
      version: summary.appVersion,
      exportTime: exportDate,
      count: summary.count,
      compatible: summary.compatibility.compatible,
      compatibilityMessage: summary.compatibility.message,
      compatibilityLevel: summary.compatibility.level
    };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BackupManager;
}