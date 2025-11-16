/*
  Optional observability (Jaeger-ready) via OpenTelemetry, abstracted behind simple helpers.
  If env JAEGER_OBS_ENABLED !== "true" or deps are missing, everything is a no-op.
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
let traceExporter: any = null;
let metricExporter: any = null;
let savedOtlpHeaders: Record<string, string> = {};
let savedJaegerEndpoint: string = "";

function parseHeaders(input?: string): Record<string, string> | undefined {
  if (!input) return undefined;
  try {
    // Try JSON first
    return JSON.parse(input);
  } catch (_) {
    // Fallback: comma or semicolon-separated key=value
    const headers: Record<string, string> = {};
    // Support both comma and semicolon as separators (for cURL compatibility)
    const separators = input.includes(";") ? ";" : ",";
    for (const part of input.split(separators)) {
      const idx = part.indexOf("=");
      if (idx > 0)
        headers[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    return Object.keys(headers).length ? headers : undefined;
  }
}

export interface ObservabilityConfig {
  serviceName?: string;
  jaegerEndpoint?: string; // Jaeger collector endpoint (e.g., http://localhost:14268/api/traces)
  otlpTracesUrl?: string; // Legacy OTLP URL (deprecated, use jaegerEndpoint)
  otlpHeaders?: Record<string, string>; // Not used with Jaeger exporter
  // Legacy Grafana fields (deprecated, kept for backward compatibility)
  grafanaApiKey?: string;
  grafanaInstanceId?: string;
  grafanaAuthScheme?: string;
  // Legacy metrics fields (deprecated, metrics disabled for now)
  prometheusPort?: number;
  prometheusEndpoint?: string;
  otlpMetricsUrl?: string;
}

export async function initObservability(config?: ObservabilityConfig) {
  if (initialized) return;
  // Support both JAEGER_OBS_ENABLED and legacy GRAFANA_OBS_ENABLED for backward compatibility
  const obsEnabled = process.env.JAEGER_OBS_ENABLED === "true" || process.env.GRAFANA_OBS_ENABLED === "true";
  if (!obsEnabled) {
    return; // no-op, initialized blijft false
  }

  const serviceName =
    config?.serviceName || process.env.SERVICE_NAME || "agent-loop";
  
  // OTLP endpoint for Jaeger - defaults to Jaeger's OTLP HTTP endpoint
  const otlpTracesUrl =
    config?.otlpTracesUrl ||
    config?.jaegerEndpoint ||
    process.env.JAEGER_OTLP_TRACES_URL ||
    process.env.JAEGER_ENDPOINT ||    
    "http://localhost:4318/v1/traces";
  
  // Ensure the URL includes /v1/traces if it's just a base URL
  let finalOtlpUrl = otlpTracesUrl;
  if (!finalOtlpUrl.includes("/v1/traces") && !finalOtlpUrl.includes("/api/traces")) {
    // If it's just a base URL, append /v1/traces
    finalOtlpUrl = finalOtlpUrl.replace(/\/$/, '') + "/v1/traces";
  }

  // Save endpoint for error messages in shutdown
  savedJaegerEndpoint = finalOtlpUrl;
  console.log("savedJaegerEndpoint", savedJaegerEndpoint);

  try {
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { Resource },
      { SemanticResourceAttributes },
      { trace, SpanKind },
      HttpInstrumentationModule,
      UndiciInstrumentationModule,
    ] = await Promise.all([
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/sdk-node") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/exporter-trace-otlp-http") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/resources") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/semantic-conventions") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/api") as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/instrumentation-http").catch(() => null) as any,
      // @ts-ignore: optional dependency may be missing during type-check
      import("@opentelemetry/instrumentation-undici").catch(() => null) as any,
    ]);

    // Extract instrumentations if available
    const HttpInstrumentation = HttpInstrumentationModule?.HttpInstrumentation;
    const UndiciInstrumentation = UndiciInstrumentationModule?.UndiciInstrumentation;

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.1",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    });

    // Initialize OTLP trace exporter for Jaeger
    // Jaeger supports OTLP on port 4318 at /v1/traces
    traceExporter = new OTLPTraceExporter({
      url: finalOtlpUrl,
    });

    // Metrics are disabled for now - focusing on traces only
    // Jaeger only accepts traces, not metrics or logs

    // Build instrumentations array
    const instrumentations: any[] = [];
    if (HttpInstrumentation) {
      instrumentations.push(new HttpInstrumentation());
    }
    if (UndiciInstrumentation) {
      instrumentations.push(new UndiciInstrumentation());
    }

    sdk = new NodeSDK({
      resource,
      traceExporter,
      // No metricReader - metrics disabled for now
      instrumentations: instrumentations.length > 0 ? instrumentations : undefined,
    });

    await sdk.start();

    tracer = trace.getTracer(serviceName);
    // Meter is optional - metrics are disabled for now
    meter = null;

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
              kind: SpanKind?.INTERNAL ?? 1,
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

    // Meter validation skipped - metrics are disabled for now

    // Check trace exporter
    if (!traceExporter) {
      validationErrors.push("OTLP trace exporter failed to initialize");
    } else {
      // Verify exporter has correct configuration
      try {
        // Check if exporter has export method (basic validation)
        if (typeof traceExporter.export !== "function") {
          validationErrors.push("OTLP trace exporter missing export method");
        }
      } catch (exporterErr) {
        validationErrors.push(
          `OTLP trace exporter validation failed: ${
            exporterErr instanceof Error
              ? exporterErr.message
              : String(exporterErr)
          }`
        );
      }
    }

    // Metric reader validation skipped - metrics are disabled for now

    // If validation fails, log errors and exit
    if (validationErrors.length > 0) {
      console.error(
        "❌ Jaeger observability initialization validation failed:"
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
    console.log("✅ Jaeger observability initialized successfully");

        // Log Jaeger trace exporter status and test connectivity
    if (traceExporter) {
      console.log(`   ✅ OTLP trace exporter initialized successfully`);
      console.log(`   📡 Traces will be exported to: ${finalOtlpUrl}`);
      console.log(`   🌐 Jaeger UI: http://localhost:16686`);
      console.log(`   ℹ️  Authentication: not required for local Jaeger`);

        // Test connection by sending a test trace and flushing immediately
        console.log(`   🧪 Testing connection to Jaeger...`);
        try {
          // Create a test span
          await tracer.startActiveSpan(
            "observability.connection.test",
            {
              kind: SpanKind?.INTERNAL ?? 1,
            },
            async (testSpan: any) => {
              testSpan.setAttribute("test", true);
              testSpan.setAttribute("connection.test", "startup");
              testSpan.setAttribute("timestamp", Date.now());
              testSpan.end();
            }
          );

          // Try multiple methods to force immediate flush
          let flushSuccess = false;
          let flushError: any = null;

          // Method 1: Try SDK's forceFlush if available
          if (sdk && typeof sdk.forceFlush === "function") {
            try {
              const flushPromise = sdk.forceFlush();
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("Flush timeout after 5 seconds")),
                  5000
                )
              );
              await Promise.race([flushPromise, timeoutPromise]);
              flushSuccess = true;
            } catch (err) {
              flushError = err;
            }
          }

          // If flush fails, log warning but continue (don't shutdown/restart - it's fragile)
          if (!flushSuccess) {
            console.warn(`   ⚠️  Could not flush traces immediately (timeout or error)`);
            console.warn(`   ⚠️  This is not critical - traces will be exported in the next batch`);
            if (flushError) {
              const errorMsg = flushError instanceof Error ? flushError.message : String(flushError);
              const errorStack = flushError instanceof Error ? flushError.stack : undefined;
              
              console.warn(`   ⚠️  Flush error: ${errorMsg}`);
              
              // Check if it's an authentication error
              const isAuthError = 
                errorMsg.includes("Unauthorized") ||
                errorMsg.includes("401") ||
                errorMsg.includes("403") ||
                errorMsg.includes("Forbidden") ||
                (errorStack && (
                  errorStack.includes("401") ||
                  errorStack.includes("403") ||
                  errorStack.includes("Unauthorized") ||
                  errorStack.includes("Forbidden")
                ));
              
              if (isAuthError) {
                console.warn(`   ⚠️  This appears to be an authentication error`);
                console.warn(`   ⚠️  For local Jaeger, authentication is typically not required`);
              }
              
              // Always log error details (helpful for debugging)
              if (errorStack) {
                // In development, show full stack; in production, show more concise info
                if (process.env.NODE_ENV === "development") {
                  console.warn(`   ⚠️  Full error stack:`);
                  console.warn(errorStack);
                } else {
                  // In production, show first few lines of stack for context
                  const stackLines = errorStack.split("\n").slice(0, 5).join("\n");
                  console.warn(`   ⚠️  Error context:\n${stackLines}`);
                }
              }
              
              // Log error details if available (like HTTP status, response, etc.)
              if (flushError && typeof flushError === "object") {
                const errorDetails: string[] = [];
                if ("status" in flushError) {
                  errorDetails.push(`HTTP status: ${flushError.status}`);
                }
                if ("statusCode" in flushError) {
                  errorDetails.push(`HTTP status code: ${flushError.statusCode}`);
                }
                if ("response" in flushError) {
                  const response = (flushError as any).response;
                  if (response) {
                    if (typeof response === "string") {
                      errorDetails.push(`Response: ${response.substring(0, 200)}`);
                    } else if (typeof response === "object") {
                      try {
                        const responseStr = JSON.stringify(response).substring(0, 200);
                        errorDetails.push(`Response: ${responseStr}`);
                      } catch {
                        errorDetails.push(`Response: [object]`);
                      }
                    }
                  }
                }
                if (errorDetails.length > 0) {
                  console.warn(`   ⚠️  Error details: ${errorDetails.join(", ")}`);
                }
              }
            }
          } else {
            console.log(`   ✅ Connection test successful - authentication verified`);
          }
        } catch (testErr: any) {
          const errorMessage =
            testErr instanceof Error ? testErr.message : String(testErr);

          // Check if it's an authentication error
          if (
            errorMessage.includes("Unauthorized") ||
            errorMessage.includes("401") ||
            errorMessage.includes("403") ||
            errorMessage.includes("authentication") ||
            errorMessage.includes("authorization")
          ) {
            console.error(`\n❌ Connection test failed!`);
            console.error(`   The connection to Jaeger was rejected.`);
            console.error(`\n   This usually means:`);
            console.error(
              `   - The OTLP endpoint URL might be incorrect (expected: http://localhost:4318/v1/traces)`
            );
            console.error(`   - Jaeger collector might not be running`);
            console.error(`   - Network connectivity issues`);
            console.error(`\n   💡 Troubleshooting:`);
            console.error(`      - Ensure Jaeger is running: docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest`);
            console.error(`      - Check Jaeger UI: http://localhost:16686`);
            console.error(`      - Verify OTLP endpoint: ${finalOtlpUrl}`);
            console.error(`      - For local Jaeger, authentication is typically not required`);
            console.error(`\n   Application will now exit.`);
            try {
              await sdk?.shutdown();
            } catch (_) {}
            process.exit(1);
          } else {
            // Other errors (network, etc.) - warn but don't exit
            console.warn(
              `   ⚠️  Connection test failed: ${errorMessage}`
            );
            console.warn(
              `   Application will continue, but traces may not be exported.`
            );
          }
        }
      } else {
        console.log(
          `   ⚠️  Jaeger exporter failed to initialize`
        );
      }

    // Metrics are disabled for now - only traces are exported to Jaeger

    // Graceful shutdown handlers
    const shutdown = async () => {
      try {
        await sdk?.shutdown();
      } catch (_) {}
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    initialized = true;
  } catch (err) {
    // If observability is explicitly enabled but fails, log and exit
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    console.error("❌ Jaeger observability initialization failed:");
    console.error(`   Error: ${errorMessage}`);
    if (errorStack) {
      console.error(`   Stack: ${errorStack}`);
    }
    console.error("\n   This may be due to:");
    console.error("   - Missing OpenTelemetry dependencies (run: npm install)");
    console.error(
      "   - Invalid configuration (check JAEGER_* environment variables)"
    );
    console.error("   - Network issues connecting to Jaeger OTLP endpoint");
    console.error("   - Jaeger collector not running (expected at http://localhost:4318)");
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
      // SpanKind may not be available in this scope, use numeric fallback
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

  // Meter verification skipped - metrics are disabled for now
  result.meterWorking = false;

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

/**
 * Gracefully shutdown the OpenTelemetry SDK, flushing all traces.
 * This should be called before process.exit() to ensure traces are sent to Jaeger.
 * Note: Metrics are disabled for now - only traces are exported.
 */
export async function shutdownObservability(): Promise<void> {
  if (!initialized || !sdk) {
    return;
  }

  try {
    console.log("🔄 Shutting down observability and flushing traces...");
    
    // Jaeger exporter doesn't use headers - no header restoration needed
    // Metrics are disabled - only flushing traces
    // Try to flush traces with timeout
    const flushPromises: Promise<any>[] = [];
    
    // Flush traces if we have a trace exporter
    if (traceExporter && typeof sdk.forceFlush === "function") {
      flushPromises.push(
        Promise.race([
          sdk.forceFlush(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Trace flush timeout")), 8000)
          ),
        ]).catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          // Only warn if it's not a timeout (timeouts are expected)
          if (!errMsg.includes("timeout")) {
            console.warn(`   ⚠️  Trace flush warning: ${errMsg}`);
          }
          return null; // Continue anyway
        })
      );
    }
    
    // Wait for flushes with overall timeout
    try {
      await Promise.race([
        Promise.allSettled(flushPromises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Overall flush timeout")), 10000)
        ),
      ]);
    } catch (flushErr) {
      // Flush timeout/error is not critical - shutdown will still export
      const flushErrorMsg = flushErr instanceof Error ? flushErr.message : String(flushErr);
      if (!flushErrorMsg.includes("timeout")) {
        console.warn(`   ⚠️  Flush warnings (will continue with shutdown): ${flushErrorMsg}`);
      }
    }

    // Shutdown the SDK - this will flush remaining data
    // Use a timeout to prevent hanging
    const shutdownPromise = sdk.shutdown();
    const shutdownTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Shutdown timeout after 15 seconds")), 15000)
    );

    await Promise.race([shutdownPromise, shutdownTimeout]);
    
    console.log("✅ Observability shutdown complete - traces flushed");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    // Check for authentication errors (401, 403, Unauthorized)
    const isAuthError =
      errorMessage.includes("Unauthorized") ||
      errorMessage.includes("401") ||
      errorMessage.includes("403") ||
      errorMessage.includes("Forbidden") ||
      (errorStack && (
        errorStack.includes("401") ||
        errorStack.includes("403") ||
        errorStack.includes("Unauthorized") ||
        errorStack.includes("Forbidden")
      ));

    if (isAuthError) {
      console.error(
        `❌ Error when flushing traces to Jaeger`, errorMessage,errorStack
      );
      
      console.error(`\n   The error occurred in the traces exporter.`);
      console.error(`\n   This usually means:`);
      console.error(
        `   - The OTLP endpoint URL might be incorrect (expected: http://localhost:4318/v1/traces)`
      );
      console.error(`   - Jaeger collector might not be running`);
      console.error(`   - Network connectivity issues`);
      
      // Jaeger exporter doesn't use headers - no need to check them
      console.error(`\n   💡 Troubleshooting steps:`);
      console.error(`      1. Ensure Jaeger is running: docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest`);
      console.error(`      2. Check Jaeger UI: http://localhost:16686`);
      console.error(`      3. Verify OTLP endpoint: ${savedJaegerEndpoint}`);
      console.error(`      4. For local Jaeger, authentication is typically not required`);
      
      if (errorStack && process.env.NODE_ENV === "development") {
        console.error(`\n   Full error stack: ${errorStack}`);
      }
      
      // For auth errors, this might indicate a config issue, but don't crash
      console.warn(`\n   ⚠️  Application will continue to exit normally.`);
      console.warn(`   ⚠️  Some traces/metrics may not have been exported.`);
    } else if (errorMessage.includes("timeout")) {
      // Timeout errors - not critical
      console.warn(`⚠️  Shutdown timeout: ${errorMessage}`);
      console.warn(`   ⚠️  This is usually not critical - data may still be exported in background`);
      console.warn(`   ⚠️  Application will continue to exit normally.`);
    } else {
      // Other errors - might be network issues, etc.
      console.warn(`⚠️  Error during observability shutdown: ${errorMessage}`);
      if (errorStack && process.env.NODE_ENV === "development") {
        console.warn(`   Stack: ${errorStack}`);
      }
      console.warn(`   ⚠️  Application will continue to exit normally.`);
    }
    // Don't throw - we still want to exit cleanly even if shutdown fails
  }
}
