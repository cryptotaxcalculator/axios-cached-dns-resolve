import pino, { Logger } from 'pino'

let logger: Logger

export function init(options: pino.LoggerOptions) {
  return (logger = pino(options))
}

export function getLogger() {
  return logger
}
