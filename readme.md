# Agent Loop - Coding Agent

## Overview

This project is a simple coding agent implemented with an Agent Loop architecture.

It runs OpenAI LLM calls in a loop and depending on the response, it can read files, search the repo, write patches, run commands, and evaluate work quality. The agent continues this loop until it reaches a final answer or a maximum number of iterations.

## Key Features

- **Manual Tool Calls**: Uses manual tool calls instead of OpenAI function calling for more control
- **Dual Patch Formats**: Supports both full-file patches (for new files) and unified diff patches (for incremental improvements)
- **Work Evaluation**: Built-in evaluation tool that analyzes created files and provides structured feedback with scores, strengths, improvements, and specific suggestions
- **Robust Diff Parsing**: Enhanced diff patch parsing with fallback mechanisms for edge cases
- **Iterative Workflow**: Agent follows a structured workflow: create → evaluate → improve with diff patches → re-evaluate

## Tools Available

1. **read_files**: Read and analyze existing files
2. **search_repo**: Search the repository for patterns or content
3. **write_patch**: Apply patches in unified diff format (preferred) or full-file format
4. **run_cmd**: Execute shell commands
5. **evaluate_work**: Analyze files and provide structured feedback for improvements
6. **final_answer**: Complete the task and generate a summary

## Architecture Diagram

```mermaid
flowchart TD
    A[Start Agent] --> B[Initialize Config & Transcript]
    B --> C[Step Counter: 1 to maxSteps]
    C --> D[Make OpenAI API Call]
    D --> E{Parse Decision}

    E -->|Parse Error| F[Default to final_answer]
    E -->|Success| G{Decision Type?}

    G -->|read_files| H[Read Files Tool]
    G -->|search_repo| I[Search Repository Tool]
    G -->|write_patch| J[Write Patch Tool]
    G -->|run_cmd| K[Run Command Tool]
    G -->|evaluate_work| L[Evaluate Work Tool]
    G -->|final_answer| M[Generate Summary]
    G -->|unknown| N[Log Error & Continue]

    H --> O[Update Transcript]
    I --> O
    J --> P{Check Write Limit}
    K --> Q{Check Command Limit}
    L --> R[Analyze Files & Generate Feedback]
    N --> O

    P -->|Within Limit| O
    P -->|Exceeded| S[Stop: Write Limit Reached]
    Q -->|Within Limit| O
    Q -->|Exceeded| T[Stop: Command Limit Reached]

    R --> U[Add Evaluation Results to Transcript]
    U --> O

    O --> V{Step < maxSteps?}
    V -->|Yes| C
    V -->|No| W[Stop: Max Steps Reached]

    M --> X[Return Final Result]
    S --> X
    T --> X
    W --> X
    X --> Y[Process Exit]

    style A fill:#e1f5fe
    style X fill:#c8e6c9
    style Y fill:#ffcdd2
    style D fill:#fff3e0
    style G fill:#f3e5f5
    style L fill:#e8f5e8
    style R fill:#e8f5e8
    style U fill:#e8f5e8
```

## Environment Variables:

- OPENAI_API_KEY : Your OpenAI API key (required)
- AGENT_CONSOLE_LOGGING=false : Disable console logging (default: true)
- AGENT_FILE_LOGGING=true : Enable file logging (default: false)
- AGENT_LOG_FILE=path/to/log : Log file path (default: agent-log.txt)

## Installation

```bash
npm install
npm start
```
