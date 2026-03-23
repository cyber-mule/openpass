/**
 * TOTPPass - 加密工具模块
 * 使用 Web Crypto API 实现 AES-GCM 加密
 */

class CryptoUtils {
  /**
   * 从密码派生密钥
   * 使用 PBKDF2 算法
   */
  static async deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    // 导入原始密钥
    const baseKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // 派生 AES-GCM 密钥
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 加密数据
   * @param {string} plaintext - 明文
   * @param {string} password - 密码
   * @returns {Promise<string>} - Base64 编码的加密数据
   */
  static async encrypt(plaintext, password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // 生成随机 salt 和 iv
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // 派生密钥
    const key = await this.deriveKey(password, salt);

    // 加密
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    // 组合: salt(16) + iv(12) + encrypted
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // 转换为 Base64
    return this.arrayBufferToBase64(combined.buffer);
  }

  /**
   * 解密数据
   * @param {string} ciphertext - Base64 编码的加密数据
   * @param {string} password - 密码
   * @returns {Promise<string>} - 明文
   */
  static async decrypt(ciphertext, password) {
    const decoder = new TextDecoder();

    // Base64 解码
    const combined = new Uint8Array(this.base64ToArrayBuffer(ciphertext));

    // 提取 salt, iv, encrypted
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);

    // 派生密钥
    const key = await this.deriveKey(password, salt);

    // 解密
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    return decoder.decode(decrypted);
  }

  /**
   * 计算密码哈希（用于验证）
   */
  static async hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + this.arrayBufferToBase64(salt));

    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return this.arrayBufferToBase64(hashBuffer);
  }

  /**
   * 生成随机 salt
   */
  static generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return this.arrayBufferToBase64(salt.buffer);
  }

  /**
   * 验证主密码
   */
  static async verifyMasterPassword(password, storedHash, salt) {
    const saltBuffer = this.base64ToArrayBuffer(salt);
    const hash = await this.hashPassword(password, new Uint8Array(saltBuffer));
    return hash === storedHash;
  }

  /**
   * 创建主密码哈希
   */
  static async createMasterPasswordHash(password) {
    const salt = this.generateSalt();
    const saltBuffer = this.base64ToArrayBuffer(salt);
    const hash = await this.hashPassword(password, new Uint8Array(saltBuffer));
    return { hash, salt };
  }

  /**
   * ArrayBuffer 转 Base64
   */
  static arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Base64 转 ArrayBuffer
   */
  static base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// 会话管理
class SessionManager {
  /**
   * 创建会话（存储到 chrome.storage.session）
   */
  async createSession(masterPassword) {
    await chrome.storage.session.set({ sessionKey: masterPassword });
  }

  /**
   * 获取会话密钥
   */
  async getSessionKey() {
    const result = await chrome.storage.session.get(['sessionKey']);
    return result.sessionKey || null;
  }

  /**
   * 清除会话
   */
  async clearSession() {
    await chrome.storage.session.remove(['sessionKey']);
  }

  /**
   * 检查是否已认证
   */
  async isAuthenticated() {
    const key = await this.getSessionKey();
    return key !== null;
  }
}

// 全局会话实例
const sessionManager = new SessionManager();