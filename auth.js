/**
 * TOTPPass - 认证页面逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('authForm');
  const passwordInput = document.getElementById('password');
  const errorText = document.getElementById('errorText');
  const submitBtn = document.getElementById('submitBtn');
  const attemptsInfo = document.getElementById('attemptsInfo');

  // 最大尝试次数
  const MAX_ATTEMPTS = 5;
  let attempts = 0;

  // 切换密码可见性
  document.querySelector('.toggle-password').addEventListener('click', function() {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    this.innerHTML = isPassword
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  // 获取重定向目标
  const urlParams = new URLSearchParams(window.location.search);
  const redirect = urlParams.get('redirect') || 'manager.html';

  // 提交表单
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = passwordInput.value;
    if (!password) {
      errorText.textContent = '请输入主密码';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '验证中...';

    try {
      // 获取存储的哈希和盐
      const result = await chrome.storage.local.get(['masterPasswordHash', 'masterPasswordSalt']);

      if (!result.masterPasswordHash || !result.masterPasswordSalt) {
        errorText.textContent = '系统错误，请重新设置';
        return;
      }

      // 验证密码
      const isValid = await CryptoUtils.verifyMasterPassword(
        password,
        result.masterPasswordHash,
        result.masterPasswordSalt
      );

      if (isValid) {
        // 创建会话
        await sessionManager.createSession(password);

        // 重置尝试次数
        await chrome.storage.local.remove(['authAttempts']);

        // 跳转
        window.location.href = redirect;
      } else {
        attempts++;

        // 存储尝试次数
        await chrome.storage.local.set({ authAttempts: attempts });

        if (attempts >= MAX_ATTEMPTS) {
          errorText.textContent = '尝试次数过多，请稍后再试';
          submitBtn.disabled = true;
          submitBtn.textContent = '已锁定';

          // 5分钟后解锁
          setTimeout(() => {
            attempts = 0;
            chrome.storage.local.remove(['authAttempts']);
            submitBtn.disabled = false;
            submitBtn.textContent = '解锁';
            errorText.textContent = '';
            attemptsInfo.textContent = '';
          }, 5 * 60 * 1000);
        } else {
          errorText.textContent = '主密码错误';
          submitBtn.disabled = false;
          submitBtn.textContent = '解锁';
          attemptsInfo.innerHTML = `剩余尝试次数：<span>${MAX_ATTEMPTS - attempts}</span>`;
          passwordInput.value = '';
          passwordInput.focus();
        }
      }
    } catch (error) {
      console.error('验证失败:', error);
      errorText.textContent = '验证失败，请重试';
      submitBtn.disabled = false;
      submitBtn.textContent = '解锁';
    }
  });

  // 加载已有的尝试次数
  chrome.storage.local.get(['authAttempts'], (result) => {
    if (result.authAttempts) {
      attempts = result.authAttempts;
      if (attempts > 0) {
        attemptsInfo.innerHTML = `剩余尝试次数：<span>${MAX_ATTEMPTS - attempts}</span>`;
      }
    }
  });
});