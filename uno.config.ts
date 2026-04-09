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
    'btn': 'px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
    'btn-secondary': 'btn bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400',
    'btn-danger': 'btn bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
    'input': 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all',
    'form-group': 'space-y-2',
    'form-label': 'block text-sm font-medium text-gray-700',
    'modal-overlay': 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4',
    'modal-content': 'bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto',
    'modal-header': 'px-6 py-4 border-b border-gray-200',
    'modal-body': 'px-6 py-4',
    'modal-footer': 'px-6 py-4 border-t border-gray-200 flex justify-end gap-3',
  }
});
