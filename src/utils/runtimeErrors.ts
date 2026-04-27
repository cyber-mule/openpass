import type { App } from 'vue';
import { getErrorMessage } from '@/utils/error';

const RUNTIME_ERRORS_KEY = 'runtimeErrors';
const MAX_RUNTIME_ERRORS = 20;

export interface RuntimeErrorEntry {
  id: string;
  scope: string;
  message: string;
  details?: string;
  stack?: string;
  createdAt: string;
}

type ErrorEventTarget = {
  addEventListener: (
    type: 'error' | 'unhandledrejection',
    listener: (event: any) => void
  ) => void;
};

function createErrorId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readRuntimeErrors(): Promise<RuntimeErrorEntry[]> {
  try {
    const result = await chrome.storage.local.get<{ runtimeErrors?: RuntimeErrorEntry[] }>([
      RUNTIME_ERRORS_KEY
    ]);
    return Array.isArray(result.runtimeErrors) ? result.runtimeErrors : [];
  } catch {
    return [];
  }
}

function createReporter(scope: string) {
  return (error: unknown, details?: string) => {
    void recordRuntimeError({ scope, error, details }).catch((recordError) => {
      console.error(`[${scope}] failed to record runtime error`, recordError);
    });
  };
}

export async function getRuntimeErrors() {
  return readRuntimeErrors();
}

export async function clearRuntimeErrors() {
  await chrome.storage.local.set({ [RUNTIME_ERRORS_KEY]: [] });
}

export async function recordRuntimeError(input: {
  scope: string;
  error: unknown;
  details?: string;
}) {
  const entry: RuntimeErrorEntry = {
    id: createErrorId(),
    scope: input.scope,
    message: getErrorMessage(input.error, '未知错误'),
    details: input.details,
    stack: input.error instanceof Error ? input.error.stack : undefined,
    createdAt: new Date().toISOString()
  };

  const existing = await readRuntimeErrors();
  const next = [entry, ...existing].slice(0, MAX_RUNTIME_ERRORS);
  await chrome.storage.local.set({ [RUNTIME_ERRORS_KEY]: next });
  return entry;
}

export function installGlobalRuntimeErrorListeners(
  scope: string,
  target: ErrorEventTarget = window
) {
  const report = createReporter(scope);

  target.addEventListener('error', (event) => {
    report(event.error ?? new Error(event.message), event.filename || 'global.error');
  });

  target.addEventListener('unhandledrejection', (event) => {
    report(event.reason, 'unhandledrejection');
  });
}

export function installRuntimeErrorReporter(app: App<Element>, scope: string) {
  const report = createReporter(scope);
  installGlobalRuntimeErrorListeners(scope);

  const previousErrorHandler = app.config.errorHandler;
  app.config.errorHandler = (error, instance, info) => {
    report(error, `vue:${info}`);
    console.error(`[${scope}] Vue error`, error, info, instance);
    previousErrorHandler?.(error, instance, info);
  };
}
