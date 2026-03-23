import pino from 'pino';

const targets: pino.TransportTargetOptions[] = [
  { target: 'pino-pretty', options: { colorize: true } },
];

// Send logs to an OTEL collector when configured
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  targets.push({
    target: 'pino-opentelemetry-transport',
    options: {
      resourceAttributes: { 'service.name': 'nanoclaw' },
      logRecordProcessorOptions: [
        {
          recordProcessorType: 'batch',
          exporterOptions: {
            protocol: 'grpc',
            grpcExporterOptions: {
              url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
            },
          },
        },
      ],
    },
  });
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
