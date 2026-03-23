/**
 * OTEL Metrics for NanoClaw
 * Activates only when OTEL_EXPORTER_OTLP_ENDPOINT is set, otherwise returns no-op instruments.
 */
import { Counter, Histogram, Meter, metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let provider: MeterProvider | null = null;

function setup(): Meter {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // No endpoint configured — OTEL API returns no-op instruments by default
    return metrics.getMeter('nanoclaw');
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'nanoclaw',
  });

  const exporter = new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 15000,
  });

  provider = new MeterProvider({
    resource,
    readers: [reader],
  });

  metrics.setGlobalMeterProvider(provider);

  return metrics.getMeter('nanoclaw');
}

const meter = setup();

// --- Instruments ---

export const messagesReceived: Counter = meter.createCounter(
  'nanoclaw.messages.received',
  { description: 'Inbound messages processed' },
);

export const messagesSent: Counter = meter.createCounter(
  'nanoclaw.messages.sent',
  { description: 'Outbound messages sent' },
);

export const containerSpawns: Counter = meter.createCounter(
  'nanoclaw.container.spawns',
  { description: 'Containers launched' },
);

export const containerDuration: Histogram = meter.createHistogram(
  'nanoclaw.container.duration_ms',
  { description: 'Container execution time in milliseconds' },
);

export const taskExecutions: Counter = meter.createCounter(
  'nanoclaw.task.executions',
  { description: 'Scheduled task runs' },
);

export const taskDuration: Histogram = meter.createHistogram(
  'nanoclaw.task.duration_ms',
  { description: 'Task execution time in milliseconds' },
);

export const retries: Counter = meter.createCounter('nanoclaw.retries', {
  description: 'Message processing retries',
});

export const tokensInput: Counter = meter.createCounter(
  'nanoclaw.tokens.input',
  { description: 'Input tokens consumed' },
);

export const tokensOutput: Counter = meter.createCounter(
  'nanoclaw.tokens.output',
  { description: 'Output tokens consumed' },
);

export const tokensCacheRead: Counter = meter.createCounter(
  'nanoclaw.tokens.cache_read',
  { description: 'Cache read tokens' },
);

export const tokensCacheCreation: Counter = meter.createCounter(
  'nanoclaw.tokens.cache_creation',
  { description: 'Cache creation tokens' },
);

export const costUsd: Counter = meter.createCounter('nanoclaw.cost.usd', {
  description: 'Total cost in USD',
});

export async function shutdownMetrics(): Promise<void> {
  if (provider) {
    await provider.shutdown();
  }
}
