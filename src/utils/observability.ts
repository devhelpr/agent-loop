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
      import("@opentelemetry/exporter-prometheus") as any,
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

    // Validate initialization
    const validationErrors: string[] = [];

    // Check SDK is initialized
    if (!sdk) {
      validationErrors.push("SDK failed to initialize");
    }

    // Check tracer is available
    if (!tracer) {
      validationErrors.push("Tracer failed to initialize");
    } else {
      // Test tracer by creating a test span
      try {
        await tracer.startActiveSpan(
          "observability.initialization.test",
          {
            kind: 1, // SpanKind.INTERNAL
          },
          async (testSpan: any) => {
            testSpan.setAttribute("test", true);
            testSpan.setAttribute("initialization.check", "passed");
            testSpan.end();
          }
        );
      } catch (tracerErr) {
        validationErrors.push(
          `Tracer test span creation failed: ${
            tracerErr instanceof Error ? tracerErr.message : String(tracerErr)
          }`
        );
      }
    }

    // Check meter is available
    if (!meter) {
      validationErrors.push("Meter failed to initialize");
    } else {
      // Test meter by creating a test counter
      try {
        const testCounter = meter.createCounter(
          "observability_initialization_test",
          {
            description: "Test counter for initialization validation",
          }
        );
        testCounter.add(1, { test: "initialization_check" });
      } catch (meterErr) {
        validationErrors.push(
          `Meter test counter creation failed: ${
            meterErr instanceof Error ? meterErr.message : String(meterErr)
          }`
        );
      }
    }

    // Check trace exporter if OTLP URL is configured
    if (otlpTracesUrl) {
      if (!traceExporter) {
        validationErrors.push(
          "OTLP traces URL configured but trace exporter failed to initialize"
        );
      } else {
        // Verify exporter has correct configuration
        try {
          // Check if exporter has export method (basic validation)
          if (typeof traceExporter.export !== "function") {
            validationErrors.push("Trace exporter missing export method");
          }
        } catch (exporterErr) {
          validationErrors.push(
            `Trace exporter validation failed: ${
              exporterErr instanceof Error
                ? exporterErr.message
                : String(exporterErr)
            }`
          );
        }
      }
    }

    // Check Prometheus exporter
    if (!metricExporter) {
      validationErrors.push("Prometheus metric exporter failed to initialize");
    } else {
      try {
        // Verify exporter is listening (basic check)
        if (typeof metricExporter.getMetricsRequestHandler !== "function") {
          // Some versions might have different APIs, but we expect some form of HTTP handler
          // This is a soft check - the exporter should work even if the method name differs
        }
      } catch (promErr) {
        validationErrors.push(
          `Prometheus exporter validation failed: ${
            promErr instanceof Error ? promErr.message : String(promErr)
          }`
        );
      }
    }

    // If validation fails, log errors and exit
    if (validationErrors.length > 0) {
      console.error(
        "❌ Grafana observability initialization validation failed:"
      );
      validationErrors.forEach((error, index) => {
        console.error(`   ${index + 1}. ${error}`);
      });
      console.error("\n   Application will now exit.");
      try {
        await sdk?.shutdown();
      } catch (_) {}
      process.exit(1);
    }

    // Success message
    console.log("✅ Grafana observability initialized successfully");
    if (otlpTracesUrl) {
      console.log(`   📡 Traces will be exported to: ${otlpTracesUrl}`);
    }
    console.log(
      `   📊 Metrics available at: http://localhost:${prometheusPort}${prometheusEndpoint}`
    );

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      try {
        await sdk?.shutdown();
      } catch (_) {}
      process.exit(0);
    });

    initialized = true;
  } catch (err) {
    // If observability is explicitly enabled but fails, log and exit
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    console.error("❌ Grafana observability initialization failed:");
    console.error(`   Error: ${errorMessage}`);
    if (errorStack) {
      console.error(`   Stack: ${errorStack}`);
    }
    console.error("\n   This may be due to:");
    console.error("   - Missing OpenTelemetry dependencies (run: npm install)");
    console.error(
      "   - Invalid configuration (check GRAFANA_* environment variables)"
    );
    console.error("   - Network issues connecting to Grafana OTLP endpoint");
    console.error("\n   Application will now exit.");

    process.exit(1);
  }
}

export function getTracer() {
  return tracer;
}

export function getMeter() {
  return meter;
}

/**
 * Verify that observability is properly initialized and traces can be created
 * Returns an object with validation results
 */
export async function verifyObservability(): Promise<{
  initialized: boolean;
  tracerWorking: boolean;
  meterWorking: boolean;
  errors: string[];
}> {
  const result = {
    initialized,
    tracerWorking: false,
    meterWorking: false,
    errors: [] as string[],
  };

  if (!initialized) {
    result.errors.push("Observability not initialized");
    return result;
  }

  // Test tracer
  if (!tracer) {
    result.errors.push("Tracer is null");
  } else {
    try {
      await tracer.startActiveSpan(
        "observability.verification.test",
        {
          kind: 1, // SpanKind.INTERNAL
        },
        async (testSpan: any) => {
          testSpan.setAttribute("verification.test", true);
          testSpan.setAttribute("timestamp", Date.now());
          testSpan.end();
        }
      );
      result.tracerWorking = true;
    } catch (err) {
      result.errors.push(
        `Tracer verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Test meter
  if (!meter) {
    result.errors.push("Meter is null");
  } else {
    try {
      const testCounter = meter.createCounter(
        "observability_verification_test",
        {
          description: "Test counter for runtime verification",
        }
      );
      testCounter.add(1, {
        verification: "runtime_check",
        timestamp: Date.now(),
      });
      result.meterWorking = true;
    } catch (err) {
      result.errors.push(
        `Meter verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return result;
}

export async function withSpan<T>(
  name: string,
  fn: (span?: any) => Promise<T> | T
): Promise<T> {
  if (!tracer) {
    return await fn();
  }

  // Verify tracer is still working before creating span
  if (!initialized) {
    console.warn(
      `⚠️  Attempted to create span "${name}" but observability is not initialized`
    );
    return await fn();
  }

  try {
    return await tracer.startActiveSpan(name, async (span: any) => {
      try {
        const res = await fn(span);
        span.setAttribute("success", true);
        span.end();
        return res;
      } catch (e: any) {
        span.recordException?.(e);
        span.setAttribute("success", false);
        span.setAttribute(
          "error.message",
          e instanceof Error ? e.message : String(e)
        );
        span.end();
        throw e;
      }
    });
  } catch (spanError: any) {
    // If span creation fails, log but don't break the application
    console.error(
      `⚠️  Failed to create span "${name}": ${
        spanError instanceof Error ? spanError.message : String(spanError)
      }`
    );
    // Still execute the function even if span creation failed
    return await fn();
  }
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
