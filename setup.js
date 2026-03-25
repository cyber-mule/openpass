/**
 * OpenPass - 主密码设置页面逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('setupForm');
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');
  const strengthFill = document.getElementById('strengthFill');
  const strengthText = document.getElementById('strengthText');
  const confirmError = document.getElementById('confirmError');
  const submitBtn = document.getElementById('submitBtn');

  /**
   * 密码强度检测
   */
  function checkStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    const levels = ['', 'weak', 'fair', 'good', 'good', 'strong'];
    const texts = ['', '弱', '一般', '良好', '良好', '强'];

    return { level: levels[score], text: texts[score] };
  }

  // 密码强度实时检测
  passwordInput.addEventListener('input', () => {
    const { level, text } = checkStrength(passwordInput.value);
    strengthFill.className = 'strength-fill ' + level;
    strengthText.textContent = text ? `密码强度：${text}` : '';
  });

  // 切换密码可见性
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const isPassword = target.type === 'password';
      target.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    });
  });

  // 确认密码验证
  confirmInput.addEventListener('input', () => {
    if (confirmInput.value && confirmInput.value !== passwordInput.value) {
      confirmError.textContent = '两次输入的密码不一致';
    } else {
      confirmError.textContent = '';
    }
  });

  // 主密码输入框 Enter 跳转到确认框
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmInput.focus();
    }
  });

  // 提交表单
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = passwordInput.value;
    const confirm = confirmInput.value;

    // 验证
    if (password.length < 6) {
      confirmError.textContent = '密码至少需要 6 个字符';
      return;
    }

    if (password !== confirm) {
      confirmError.textContent = '两次输入的密码不一致';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '正在设置...';

    try {
      // 创建主密码哈希
      const { hash, salt } = await CryptoUtils.createMasterPasswordHash(password);

      // 存储哈希和盐
      await chrome.storage.local.set({
        masterPasswordHash: hash,
        masterPasswordSalt: salt,
        isSetupComplete: true
      });

      // 创建会话
      await sessionManager.createSession(password);

      // 跳转到管理页面
      window.location.href = 'manager.html';
    } catch (error) {
      console.error('设置失败:', error);
      confirmError.textContent = '设置失败，请重试';
      submitBtn.disabled = false;
      submitBtn.textContent = '创建主密码';
    }
  });
});