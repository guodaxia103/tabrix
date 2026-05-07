import pino from 'pino';

type LogContext = Record<string, unknown>;
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ComponentLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function getLogLevel(): LogLevel {
  const level = process.env.TABRIX_LOG_LEVEL;
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  return 'info';
}

const rootLogger = pino(
  {
    name: 'tabrix-native-server',
    level: getLogLevel(),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ fd: 2, sync: true }),
);

function write(level: LogLevel, component: string, message: string, context?: LogContext): void {
  rootLogger[level]({ component, ...context }, message);
}

export const logger = {
  debug(component: string, message: string, context?: LogContext): void {
    write('debug', component, message, context);
  },
  info(component: string, message: string, context?: LogContext): void {
    write('info', component, message, context);
  },
  warn(component: string, message: string, context?: LogContext): void {
    write('warn', component, message, context);
  },
  error(component: string, message: string, context?: LogContext): void {
    write('error', component, message, context);
  },
  child(component: string): ComponentLogger {
    return {
      debug(message: string, context?: LogContext): void {
        logger.debug(component, message, context);
      },
      info(message: string, context?: LogContext): void {
        logger.info(component, message, context);
      },
      warn(message: string, context?: LogContext): void {
        logger.warn(component, message, context);
      },
      error(message: string, context?: LogContext): void {
        logger.error(component, message, context);
      },
    };
  },
};
