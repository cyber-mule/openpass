/**
 * 键盘快捷键管理 Composable
 */

import { ref } from 'vue';

interface ShortcutConfig {
  onSearch: () => void;
  onAdd: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onSelectNext: () => void;
  onSelectPrevious: () => void;
  isModalOpen: () => boolean;
  isInputFocused: () => boolean;
}

export function useKeyboardShortcuts(config: ShortcutConfig) {
  const selectedIndex = ref(-1);
  const totalItems = ref(0);

  function handleEscape() {
    // 由调用者处理模态框关闭
  }

  function handleKeyDown(e: KeyboardEvent) {
    const isInputFocused = config.isInputFocused();
    const isModalOpen = config.isModalOpen();

    // Escape - 关闭模态框或取消
    if (e.key === 'Escape') {
      handleEscape();
      return;
    }

    // 在输入框中时，只处理特定快捷键
    if (isInputFocused) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // 表单提交由表单自己处理
      }
      return;
    }

    // 模态框打开时，只处理 Enter
    if (isModalOpen) {
      return;
    }

    // 全局快捷键 (Ctrl/Cmd)
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          config.onAdd();
          break;
        case 'f':
          e.preventDefault();
          config.onSearch();
          break;
        case ',':
          e.preventDefault();
          config.onSettings();
          break;
      }
      return;
    }

    // 单键快捷键
    switch (e.key) {
      case '/':
        e.preventDefault();
        config.onSearch();
        break;
      case '?':
        e.preventDefault();
        config.onHelp();
        break;
      case 'n':
        e.preventDefault();
        config.onAdd();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectPrevious();
        break;
      case 'ArrowDown':
        e.preventDefault();
        selectNext();
        break;
      case 'Enter':
        e.preventDefault();
        config.onCopy();
        break;
      case 'e':
        e.preventDefault();
        config.onEdit();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        config.onDelete();
        break;
    }
  }

  function selectPrevious() {
    if (totalItems.value === 0) return;
    selectedIndex.value = Math.max(0, selectedIndex.value - 1);
  }

  function selectNext() {
    if (totalItems.value === 0) return;
    selectedIndex.value = Math.min(totalItems.value - 1, selectedIndex.value + 1);
  }

  function clearSelection() {
    selectedIndex.value = -1;
  }

  function setTotal(count: number) {
    totalItems.value = count;
  }

  // 自动注册/注销
  function register() {
    document.addEventListener('keydown', handleKeyDown);
  }

  function unregister() {
    document.removeEventListener('keydown', handleKeyDown);
  }

  return {
    selectedIndex,
    totalItems,
    selectPrevious,
    selectNext,
    clearSelection,
    setTotal,
    register,
    unregister
  };
}
