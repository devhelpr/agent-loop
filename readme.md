# Agent Loop - Coding Agent

## Overview

This project is a simple coding agent implemented with an Agent Loop architecture.

It runs AI LLM calls in a loop using Vercel's AI SDK v5 and depending on the response, it can read files, search the repo, write patches, run commands, and evaluate work quality. The agent continues this loop until it reaches a final answer or a maximum number of iterations.

It has OpenTelemetry-based observability for tracing using Jaeger.

## Supported AI Providers

The agent supports multiple AI providers through Vercel's AI SDK v5:

- **OpenAI** (GPT-5-mini, GPT-5, etc.)
- **Anthropic** (Claude Sonnet 4.5, etc.)
- **Google** (Gemini 2.5 Flash, etc.)
- **Ollama** (Local models like Granite4, etc.)

You can switch between providers using the `--provider` CLI option or by setting the appropriate environment variables.

## Key Features

- **Planning Phase**: Automatically analyzes project structure at startup and creates execution plans for complex tasks
- **Manual Tool Calls**: Uses manual tool calls instead of OpenAI function calling for more control
- **Full-File Patches**: Uses full-file format for all file modifications (complete file content replacement)
- **Work Evaluation**: Built-in evaluation tool that analyzes created files and provides structured feedback with scores, strengths, improvements, and specific suggestions
- **Iterative Workflow**: Agent follows a structured workflow: create → evaluate → improve with full-file patches → re-evaluate
- **Multi-Provider Support**: Seamlessly switch between OpenAI, Anthropic, Google, and Ollama providers
- **Observability**: OpenTelemetry-based tracing with Jaeger integration for monitoring agent execution and debugging

## Tools Available

1. **read_files**: Read and analyze existing files
2. **search_repo**: Search the repository for patterns or content
3. **write_patch**: Apply patches using full-file format (complete file content replacement)
4. **run_cmd**: Execute shell commands
5. **evaluate_work**: Analyze files and provide structured feedback for improvements
6. **analyze_project**: Analyze project structure and context (automatically run at start)
7. **create_plan**: Create a structured execution plan for complex tasks
8. **final_answer**: Complete the task and generate a summary

## High-Level Agent Loop

```mermaid
flowchart TD
    A[User Goal] --> B[Planning Phase]
    B --> B1[Analyze Project]
    B1 --> B2{Complex Task?}
    B2 -->|Yes| B3[Create Plan]
    B2 -->|No| C
    B3 --> C[Agent Loop]
    C --> D[LLM Decision]
    D --> E[Execute Tool]
    E --> F[Update Context]
    F --> G{Task Complete?}
    G -->|No| D
    G -->|Yes| H[Final Answer]
    
    subgraph "Available Tools"
        I[read_files]
        J[search_repo]
        K[write_patch]
        L[run_cmd]
        M[evaluate_work]
        N[analyze_project]
        O[create_plan]
    end
    
    E -.-> I
    E -.-> J
    E -.-> K
    E -.-> L
    E -.-> M
    E -.-> N
    E -.-> O
    
    style A fill:#e1f5fe
    style B fill:#fff3e0
    style B1 fill:#fff3e0
    style B2 fill:#fff3e0
    style B3 fill:#fff3e0
    style C fill:#f3e5f5
    style D fill:#f3e5f5
    style E fill:#e8f5e8
    style F fill:#fff9c4
    style G fill:#ffecb3
    style H fill:#c8e6c9
    style I fill:#f0f8ff
    style J fill:#f0f8ff
    style K fill:#f0f8ff
    style L fill:#f0f8ff
    style M fill:#f0f8ff
    style N fill:#f0f8ff
    style O fill:#f0f8ff
```

## Detailed Architecture Diagram

```mermaid
flowchart TD
    A[Start Agent] --> B[Initialize Config & Reset Token Stats]
    B --> C[Setup Safety Caps & Transcript]
    C --> D[Planning Phase]
    
    D --> D1[Always: Analyze Project]
    D1 --> D2{Complex Task?}
    D2 -->|Yes| D3[Create Execution Plan]
    D2 -->|No| E
    D3 --> E[Step Counter: 1 to maxSteps]
    
    E --> F[Make AI API Call with Retries]
    
    F --> G{API Call Success?}
    G -->|Failed| H[Log Error & Return with Token Stats]
    G -->|Success| I[Parse JSON Response]
    
    I --> J{Parse Success?}
    J -->|Parse Error| K[Default to final_answer]
    J -->|Success| L{Decision Type?}
    
    L -->|read_files| M[Read Files Handler]
    L -->|search_repo| N[Search Repository Handler]
    L -->|write_patch| O[Write Patch Handler]
    L -->|run_cmd| P[Run Command Handler]
    L -->|evaluate_work| Q[Evaluate Work Handler]
    L -->|analyze_project| R[Analyze Project Handler]
    L -->|create_plan| S[Create Plan Handler]
    L -->|final_answer| T[Generate Summary with AI]
    L -->|unknown| U[Log Error & Add to Transcript]
    
    M --> V[Update Transcript with Results]
    N --> V
    O --> W{Check Write Limit}
    P --> X{Check Command Limit}
    Q --> Y[Analyze Files & Generate Structured Feedback]
    R --> V
    S --> V
    U --> V
    
    W -->|Within Limit| V
    W -->|Exceeded| Z[Stop: Write Limit Reached]
    X -->|Within Limit| V
    X -->|Exceeded| AA[Stop: Command Limit Reached]
    
    Y --> AB[Add Evaluation Results to Transcript]
    AB --> V
    
    V --> AC{Step < maxSteps?}
    AC -->|Yes| E
    AC -->|No| AD[Stop: Max Steps Reached]
    
    T --> AE[Display Token Summary & Return Result]
    Z --> AE
    AA --> AE
    AD --> AE
    H --> AE
    AE --> AF[Process Exit]
    
    style A fill:#e1f5fe
    style D fill:#fff3e0
    style D1 fill:#fff3e0
    style D2 fill:#fff3e0
    style D3 fill:#fff3e0
    style AE fill:#c8e6c9
    style AF fill:#ffcdd2
    style F fill:#fff3e0
    style L fill:#f3e5f5
    style Q fill:#e8f5e8
    style Y fill:#e8f5e8
    style AB fill:#e8f5e8
    style W fill:#fff9c4
    style X fill:#fff9c4
```

## CLI Usage

### Installation

Install globally to use from anywhere on your system:

**Option 1: Using the install-global script (recommended)**

```bash
npm run install-global
```

This will build the project and install it globally in one step.

**Option 2: Manual installation**

```bash
npm install -g .
```

If you need extra permissions, then:

```bash
chmod +x <path>/agent-loop/dist/src/cli.js
```

**Option 3: Use directly without installation**

```bash
npx agent-loop
```

### Basic Usage

Run the CLI in interactive mode:

```bash
agent-loop
```

Or provide a prompt directly:

```bash
agent-loop --prompt "Create a simple HTML page with CSS styling"
```

### CLI Options

```bash
agent-loop [options]

Options:
  -p, --prompt <prompt>           Direct prompt to execute (skips interactive mode)
  -m, --max-steps <number>        Maximum number of steps to execute (default: 20)
  -w, --max-writes <number>       Maximum number of file writes (default: 10)
  -c, --max-commands <number>     Maximum number of commands to run (default: 20)
  --provider <provider>           AI provider to use (openai, anthropic, google) (default: openai)
  --model <model>                 Specific model to use (optional)
  --no-console-log                Disable console logging
  --file-log                      Enable file logging
  --log-file <path>               Log file path (default: agent-log.txt)
  --test-command <command>        Test command to run (default: npm test --silent)
  --test-args <args>              Test command arguments (comma-separated)
  -h, --help                      Display help for command
  -V, --version                   Display version number
```

### Examples

```bash
# Interactive mode
agent-loop

# Direct prompt
agent-loop --prompt "Create a React component for a todo list"

# With custom limits
agent-loop --prompt "Build a calculator app" --max-steps 30 --max-writes 15

# With custom test command
agent-loop --prompt "Create a Node.js API" --test-command "npm" --test-args "test,run"

# With file logging
agent-loop --prompt "Create a website" --file-log --log-file my-agent.log

# Using different AI providers
agent-loop --prompt "Create a React app" --provider anthropic
agent-loop --prompt "Build a Python API" --provider google --model gemini-1.5-pro
agent-loop --prompt "Write TypeScript types" --provider openai --model gpt-4
agent-loop --prompt "Create a simple script" --provider ollama --model granite4:tiny-h
```

## Environment Variables:

### AI Provider API Keys (choose one):
- `OPENAI_API_KEY` : Your OpenAI API key
- `ANTHROPIC_API_KEY` : Your Anthropic API key  
- `GOOGLE_API_KEY` : Your Google API key
- `OLLAMA_BASE_URL` or `OLLAMA_HOST` : Ollama server URL (optional, defaults to localhost:11434)

### Agent Configuration:
- `AGENT_CONSOLE_LOGGING=false` : Disable console logging (default: true)
- `AGENT_FILE_LOGGING=true` : Enable file logging (default: false)
- `AGENT_LOG_FILE=path/to/log` : Log file path (default: agent-log.txt)

### Observability (Optional, Jaeger-ready):
- `JAEGER_OBS_ENABLED=true` : Enable OpenTelemetry-based observability (default: disabled)
- `SERVICE_NAME=agent-loop` : Service name for traces
- `JAEGER_OTLP_TRACES_URL=http://localhost:4318/v1/traces` : OTLP HTTP traces endpoint (default: http://localhost:4318/v1/traces)
- `JAEGER_ENDPOINT` : Alternative to JAEGER_OTLP_TRACES_URL (will be converted to OTLP format)

**Note**: Metrics are currently disabled. Only traces are exported to Jaeger using OTLP (OpenTelemetry Protocol).

Notes:
- **Jaeger Setup**: To use Jaeger, ensure it's running locally. You can start it with:
  ```bash
  docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
  ```
- **Jaeger UI**: Access the Jaeger UI at `http://localhost:16686` to view traces.
- **Traces**: Traces are exported to Jaeger's OTLP HTTP endpoint at `http://localhost:4318/v1/traces` by default using the OTLP exporter (supports both Protobuf and JSON).
- **Metrics**: Metrics are currently disabled. Only traces are exported to Jaeger.

### Provider Selection:
You can specify which AI provider to use via CLI options:
- `--provider openai` : Use OpenAI (default)
- `--provider anthropic` : Use Anthropic
- `--provider google` : Use Google
- `--provider ollama` : Use Ollama
- `--model <model-name>` : Specify a specific model (optional)

## Installation

```bash
npm install
npm start
```

## Install and run Jaeger
```bash
docker run --rm --name jaeger \
  -p 16686:16686 \
  -p 4317:4317 \
  -p 4318:4318 \
  -p 5778:5778 \
  -p 9411:9411 \
  cr.jaegertracing.io/jaegertracing/jaeger:2.11.0
```

## What did I learn?

- examples in a prompt are helpful, but can also lead to confusion and hallucinations if not used carefully. Especially with smaller models. It happened that code was generated based on examples, but was not actually what the user wanted. Same with filenames in the examples. Bigger models understand these kind of examples better.

- Ollama is a great way to run local models and helpful for testing and development and saving costs.

- Using Observability is helpful for tracing the agent's execution and debugging. Jaeger runs locally and is easy to set up using Docker.