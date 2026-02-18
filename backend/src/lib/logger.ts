const log = (level: string, ...args: unknown[]) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}]`, ...args);
};

/** Serialize error for logging — Error objects often stringify as {} */
export function formatError(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) {
    return { message: e.message, stack: e.stack };
  }
  return { message: String(e) };
}

export const logger = {
  info: (...args: unknown[]) => log("INFO", ...args),
  warn: (...args: unknown[]) => log("WARN", ...args),
  error: (...args: unknown[]) => log("ERROR", ...args),
};
