import {
  defineConfig,
  presetIcons,
  presetUno,
  presetAttributify
} from 'unocss';

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons(),
    presetAttributify()
  ],
  theme: {
    colors: {
      primary: {
        50: '#eef2ff',
        100: '#e0e7ff',
        200: '#c7d2fe',
        300: '#a5b4fc',
        400: '#818cf8',
        500: '#6366f1',
        600: '#4f46e5',
        700: '#4338ca',
        800: '#3730a3',
        900: '#312e81',
      }
    }
  },
  shortcuts: {
    // 按钮
    'btn': 'px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center',
    'btn-primary': 'btn bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
    'btn-secondary': 'btn bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 border border-gray-300',
    'btn-danger': 'btn bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
    // 输入框
    'input': 'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all placeholder:text-gray-400',
    'input-error': 'input border-red-300 focus:ring-red-500 focus:border-red-500',
    // 表单
    'form-group': 'space-y-1.5',
    'form-label': 'block text-sm font-medium text-gray-700',
    'form-error': 'text-sm text-red-600',
    // 模态框
    'modal-overlay': 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4',
    'modal-content': 'bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto',
    'modal-header': 'px-6 py-4 border-b border-gray-200',
    'modal-body': 'px-6 py-4',
    'modal-footer': 'px-6 py-4 border-t border-gray-200 flex justify-end gap-3',
  },
  rules: [
    // Toast 样式
    ['openpass-toast', {
      'position': 'fixed',
      'top': '20px',
      'right': '20px',
      'padding': '12px 20px',
      'border-radius': '8px',
      'font-size': '14px',
      'z-index': '9999',
      'opacity': '0',
      'transform': 'translateY(-10px)',
      'transition': 'all 0.3s ease',
      'box-shadow': '0 4px 12px rgba(0, 0, 0, 0.15)',
    }],
    ['openpass-toast-show', {
      'opacity': '1',
      'transform': 'translateY(0)',
    }],
    ['openpass-toast-success', {
      'background': '#10b981',
      'color': 'white',
    }],
    ['openpass-toast-error', {
      'background': '#ef4444',
      'color': 'white',
    }],
    ['openpass-toast-warning', {
      'background': '#f59e0b',
      'color': 'white',
    }],
    ['openpass-toast-default', {
      'background': '#3b82f6',
      'color': 'white',
    }],
  ]
});
