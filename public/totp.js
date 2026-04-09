/**
 * TOTP (Time-based One-Time Password) 实现
 * 基于 RFC 6238 标准
 */

class TOTP {
  /**
   * Base32 解码
   */
  static base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    str = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    
    let bits = '';
    for (let i = 0; i < str.length; i++) {
      const val = alphabet.indexOf(str[i]);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }
    
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
    }
    
    return bytes;
  }

  /**
   * HMAC-SHA1 实现
   */
  static async hmacSha1(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
    return new Uint8Array(signature);
  }

  /**
   * 动态截断
   */
  static dynamicTruncate(hmacResult) {
    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    return (
      ((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)
    );
  }

  /**
   * 生成 TOTP 验证码
   * @param {string} secret - Base32 编码的密钥
   * @param {number} digits - 验证码长度，默认 6 位
   * @param {number} time - 时间戳（秒），默认当前时间
   * @param {number} period - 时间周期（秒），默认 30 秒
   * @returns {Promise<{code: string, remainingSeconds: number}>}
   */
  static async generate(secret, digits = 6, time = null, period = 30) {
    const currentTime = time !== null ? time : Math.floor(Date.now() / 1000);
    const counter = Math.floor(currentTime / period);
    const remainingSeconds = period - (currentTime % period);
    
    // 解码密钥
    const key = this.base32Decode(secret);
    
    // 将计数器转换为大端序字节数组
    const counterBytes = new ArrayBuffer(8);
    const counterView = new DataView(counterBytes);
    counterView.setUint32(4, counter, false);
    
    // 计算 HMAC
    const hmac = await this.hmacSha1(key, new Uint8Array(counterBytes));
    
    // 动态截断
    const code = this.dynamicTruncate(hmac);
    
    // 生成指定位数的验证码
    const otp = code % Math.pow(10, digits);
    
    return {
      code: otp.toString().padStart(digits, '0'),
      remainingSeconds
    };
  }

  /**
   * 自动检测验证码长度
   * 某些密钥可能隐含长度信息，但标准 TOTP 无法从密钥推断长度
   * 默认返回 6
   */
  static detectDigits(secret) {
    // 标准 TOTP 长度为 6 或 8 位
    // 无法从密钥本身推断，返回默认值 6
    return 6;
  }

  /**
   * 验证密钥格式是否有效
   */
  static isValidSecret(secret) {
    const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
    return cleaned.length >= 16 && /^[A-Z2-7]+$/.test(cleaned);
  }
}

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TOTP;
}