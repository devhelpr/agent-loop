/*
  Optional observability (Grafana-ready) via OpenTelemetry, abstracted behind simple helpers.
  If env GRAFANA_OBS_ENABLED !== "true" or deps are missing, everything is a no-op.
*/

type OtelNodeSdk = any;
type OtelTraceExporter = any;
type OtelPromExporter = any;
type OtelResources = any;
type OtelSemantic = any;

let initialized = false;
let tracer: any = null;
let meter: any = null;
let sdk: any = null;

function parseHeaders(input?: string): Record<string, string> | undefined {
  if (!input) return undefined;
  try {
    // Try JSON first
    return JSON.parse(input);
  } catch (_) {
    // Fallback: comma-separated key=value
    const headers: Record<string, string> = {};
    for (const part of input.split(",")) {
      const idx = part.indexOf("=");
      if (idx > 0)
        headers[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    return Object.keys(headers).length ? headers : undefined;
  }
}

export interface ObservabilityConfig {
  serviceName?: string;
  prometheusPort?: number;
  prometheusEndpoint?: string;
  otlpTracesUrl?: string;
  otlpHeaders?: Record<string, string>;
  grafanaApiKey?: string;
  grafanaAuthScheme?: string; // defaults to "Bearer"
}

export async function initObservability(config?: ObservabilityConfig) {
  if (initialized) return;
  if (process.env.GRAFANA_OBS_ENABLED !== "true") {
    initialized = true;
    return; // no-op
  }

  const serviceName =
    config?.serviceName || process.env.SERVICE_NAME || "agent-loop";
  const prometheusPort =
    config?.prometheusPort || Number(process.env.GRAFANA_PROM_PORT || 9464);
  const prometheusEndpoint =
    config?.prometheusEndpoint ||
    process.env.GRAFANA_PROM_ENDPOINT ||
    "/metrics";
  const otlpTracesUrl =
    config?.otlpTracesUrl || process.env.GRAFANA_OTLP_TRACES_URL;
  let otlpHeaders =
    config?.otlpHeaders || parseHeaders(process.env.GRAFANA_OTLP_HEADERS) || {};
  const grafanaApiKey = config?.grafanaApiKey || process.env.GRAFANA_API_KEY;
  const grafanaAuthScheme = (
    config?.grafanaAuthScheme ||
    process.env.GRAFANA_OTLP_AUTH_SCHEME ||
    "Bearer"
  ).trim();

  // If user provided a dedicated API key and Authorization header is not set, add it.
  if (grafanaApiKey && !otlpHeaders["Authorization"]) {
    otlpHeaders["Authorization"] = `${grafanaAuthScheme} ${grafanaApiKey}`;
  }

  try {
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { PrometheusExporter },
      { Resource },
      { SemanticResourceAttributes },
      { trace, metrics },
    ] = await Promise.all([
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/sdk-node") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/exporter-trace-otlp-http") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/exporter-metrics-prometheus") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/resources") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/semantic-conventions") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/api") as any,
    ]);

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    });

    const traceExporter = otlpTracesUrl
      ? new OTLPTraceExporter({
          url: otlpTracesUrl,
          headers: otlpHeaders,
        })
      : undefined;

    const metricExporter = new PrometheusExporter({
      port: prometheusPort,
      endpoint: prometheusEndpoint,
    });

    sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader: metricExporter,
    });

    await sdk.start();

    tracer = trace.getTracer(serviceName);
    meter = metrics.getMeter(serviceName);

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      try {
        await sdk?.shutdown();
      } catch (_) {}
      process.exit(0);
    });

    initialized = true;
  } catch (err) {
    // Dependencies likely not installed; remain no-op
    initialized = true;
  }
}

export function getTracer() {
  return tracer;
}

export function getMeter() {
  return meter;
}

export async function withSpan<T>(
  name: string,
  fn: (span?: any) => Promise<T> | T
): Promise<T> {
  if (!tracer) {
    return await fn();
  }
  return await tracer.startActiveSpan(name, async (span: any) => {
    try {
      const res = await fn(span);
      span.setAttribute("success", true);
      span.end();
      return res;
    } catch (e: any) {
      span.recordException?.(e);
      span.setAttribute("success", false);
      span.end();
      throw e;
    }
  });
}

// Convenience helpers for metrics (safe no-ops if not initialized)
export function getCounter(name: string, description?: string) {
  if (!meter) return { add: (_v: number, _attrs?: Record<string, any>) => {} };
  const c = meter.createCounter(name, { description });
  return { add: (v: number, attrs?: Record<string, any>) => c.add(v, attrs) };
}

export function getHistogram(name: string, description?: string) {
  if (!meter)
    return { record: (_v: number, _attrs?: Record<string, any>) => {} };
  const h = meter.createHistogram(name, { description });
  return {
    record: (v: number, attrs?: Record<string, any>) => h.record(v, attrs),
  };
}
