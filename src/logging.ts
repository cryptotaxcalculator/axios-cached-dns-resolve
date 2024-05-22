import pino, { Logger } from "pino";
import pretty from "pino-pretty";
import { LoggingConfig } from "./index.d";

let logger: Logger;

export function init(options: LoggingConfig) {
  if (options.prettyPrint) {
    const prettyOptions = pretty({ colorize: true });
    options.stream = prettyOptions;
    delete options.prettyPrint; // Remove unsupported option
  }

  return (logger = pino(options));
}

export function getLogger() {
  return logger;
}
