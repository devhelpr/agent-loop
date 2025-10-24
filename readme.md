# Agent Loop - Coding Agent

## Overview

This project is a simple coding agent implemented with an Agent Loop architecture.

It runs AI LLM calls in a loop using Vercel's AI SDK v5 and depending on the response, it can read files, search the repo, write patches, run commands, and evaluate work quality. The agent continues this loop until it reaches a final answer or a maximum number of iterations.

## Supported AI Providers

The agent supports multiple AI providers through Vercel's AI SDK v5:

- **OpenAI** (GPT-5-mini, GPT-5, etc.)
- **Anthropic** (Claude Sonnet 4.5, etc.)
- **Google** (Gemini 2.5 Flash, etc.)
- **Ollama** (Local models like Granite4, etc.)

You can switch between providers using the `--provider` CLI option or by setting the appropriate environment variables.

## Key Features

- **Manual Tool Calls**: Uses manual tool calls instead of OpenAI function calling for more control
- **Dual Patch Formats**: Supports both full-file patches (for new files) and unified diff patches (for incremental improvements)
- **Work Evaluation**: Built-in evaluation tool that analyzes created files and provides structured feedback with scores, strengths, improvements, and specific suggestions
- **Diff Parsing**: Unified diff patch parsing with comprehensive error handling
- **Iterative Workflow**: Agent follows a structured workflow: create → evaluate → improve with diff patches → re-evaluate
- **Multi-Provider Support**: Seamlessly switch between OpenAI, Anthropic, Google, and Ollama providers

## Tools Available

1. **read_files**: Read and analyze existing files
2. **search_repo**: Search the repository for patterns or content
3. **write_patch**: Apply patches in unified diff format (preferred) or full-file format
4. **run_cmd**: Execute shell commands
5. **evaluate_work**: Analyze files and provide structured feedback for improvements
6. **final_answer**: Complete the task and generate a summary

## High-Level Agent Loop

```mermaid
flowchart LR
    A[User Goal] --> B[Agent Loop]
    B --> C[LLM Decision]
    C --> D[Execute Tool]
    D --> E[Update Context]
    E --> F{Task Complete?}
    F -->|No| C
    F -->|Yes| G[Final Answer]
    
    subgraph "Available Tools"
        H[read_files]
        I[search_repo]
        J[write_patch]
        K[run_cmd]
        L[evaluate_work]
    end
    
    D -.-> H
    D -.-> I
    D -.-> J
    D -.-> K
    D -.-> L
    
    style A fill:#e1f5fe
    style B fill:#fff3e0
    style C fill:#f3e5f5
    style D fill:#e8f5e8
    style E fill:#fff9c4
    style F fill:#ffecb3
    style G fill:#c8e6c9
    style H fill:#f0f8ff
    style I fill:#f0f8ff
    style J fill:#f0f8ff
    style K fill:#f0f8ff
    style L fill:#f0f8ff
```

## Detailed Architecture Diagram

```mermaid
flowchart TD
    A[Start Agent] --> B[Initialize Config & Reset Token Stats]
    B --> C[Setup Safety Caps & Transcript]
    C --> D[Step Counter: 1 to maxSteps]
    D --> E[Make AI API Call with Retries]
    
    E --> F{API Call Success?}
    F -->|Failed| G[Log Error & Return with Token Stats]
    F -->|Success| H[Parse JSON Response]
    
    H --> I{Parse Success?}
    I -->|Parse Error| J[Default to final_answer]
    I -->|Success| K{Decision Type?}
    
    K -->|read_files| L[Read Files Handler]
    K -->|search_repo| M[Search Repository Handler]
    K -->|write_patch| N[Write Patch Handler]
    K -->|run_cmd| O[Run Command Handler]
    K -->|evaluate_work| P[Evaluate Work Handler]
    K -->|final_answer| Q[Generate Summary with AI]
    K -->|unknown| R[Log Error & Add to Transcript]
    
    L --> S[Update Transcript with Results]
    M --> S
    N --> T{Check Write Limit}
    O --> U{Check Command Limit}
    P --> V[Analyze Files & Generate Structured Feedback]
    R --> S
    
    T -->|Within Limit| S
    T -->|Exceeded| W[Stop: Write Limit Reached]
    U -->|Within Limit| S
    U -->|Exceeded| X[Stop: Command Limit Reached]
    
    V --> Y[Add Evaluation Results to Transcript]
    Y --> S
    
    S --> Z{Step < maxSteps?}
    Z -->|Yes| D
    Z -->|No| AA[Stop: Max Steps Reached]
    
    Q --> BB[Display Token Summary & Return Result]
    W --> BB
    X --> BB
    AA --> BB
    G --> BB
    BB --> CC[Process Exit]
    
    style A fill:#e1f5fe
    style BB fill:#c8e6c9
    style CC fill:#ffcdd2
    style E fill:#fff3e0
    style K fill:#f3e5f5
    style P fill:#e8f5e8
    style V fill:#e8f5e8
    style Y fill:#e8f5e8
    style T fill:#fff9c4
    style U fill:#fff9c4
```

## CLI Usage

### Installation

Install globally to use from anywhere on your system:

```bash
npm install -g .
```

If you need extra permissions, then:

```bash
chmod +x <path>/agent-loop/dist/src/cli.js
```

Then you can run it with:

Or use directly without installation:

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

## What did I learn?

- examples in a prompt are helpful, but can also lead to confusion and hallucinations if not used carefully. Especially with smaller models. It happened that code was generated based on examples, but was not actually what the user wanted. Same with filenames in the examples.

- Ollama is a great way to run local models and helpful for testing and development.