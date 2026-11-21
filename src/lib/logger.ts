export const logger = {
  info: (message: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", message, ...extra })),
  warn: (message: string, extra?: Record<string, unknown>) => console.warn(JSON.stringify({ level: "warn", message, ...extra })),
  error: (message: string, extra?: Record<string, unknown>) => console.error(JSON.stringify({ level: "error", message, ...extra })),
};
