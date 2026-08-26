/**
 * POLARIS PROTOCOL - STRUCTURED LOGGER
 * Standardizes [POLARIS] prefix and log levels across the application.
 */

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

interface LogMetadata {
  module?: string;
  txHash?: string;
  address?: string;
  amount?: string;
  asset?: string;
  error?: any;
  [key: string]: any;
}

class PolarisLogger {
  private format(level: LogLevel, module: string, message: string): string {
    return `[POLARIS][${level}][${module.toUpperCase()}] ${message}`;
  }

  info(module: string, message: string, metadata?: LogMetadata) {
    console.log(this.format("INFO", module, message), metadata || "");
  }

  warn(module: string, message: string, metadata?: LogMetadata) {
    console.warn(this.format("WARN", module, message), metadata || "");
  }

  error(module: string, message: string, metadata?: LogMetadata) {
    console.error(this.format("ERROR", module, message), metadata || "");
  }

  debug(module: string, message: string, metadata?: LogMetadata) {
    if (process.env.NODE_ENV === "development") {
      console.log(this.format("DEBUG", module, message), metadata || "");
    }
  }
}

export const logger = new PolarisLogger();
