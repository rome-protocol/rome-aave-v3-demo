const IS_DEV = process.env.NODE_ENV !== "production";

export const logger = {
  log: (...args: unknown[]) => { if (IS_DEV) console.log(...args); },
  error: (...args: unknown[]) => { if (IS_DEV) console.error(...args); },
  warn: (...args: unknown[]) => { if (IS_DEV) console.warn(...args); },
  info: (...args: unknown[]) => { if (IS_DEV) console.info(...args); },
  debug: (...args: unknown[]) => { if (IS_DEV) console.debug(...args); },
};
