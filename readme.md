# Agent Loop - Coding Agent

## Overview

This project is a simple coding agent implemented with an Agent Loop architecture.

It runs OpenAI LLM calls in a loop and depending on the response, it can read files, search the repo, write patches, and run commands. The agent continues this loop until it reaches a final answer or a maximum number of iterations.

This uses manual tool calls instead of using the OpenAI function calling feature, allowing for more control over the process.

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
    G -->|final_answer| L[Generate Summary]
    G -->|unknown| M[Log Error & Continue]

    H --> N[Update Transcript]
    I --> N
    J --> O{Check Write Limit}
    K --> P{Check Command Limit}
    M --> N

    O -->|Within Limit| N
    O -->|Exceeded| Q[Stop: Write Limit Reached]
    P -->|Within Limit| N
    P -->|Exceeded| R[Stop: Command Limit Reached]

    N --> S{Step < maxSteps?}
    S -->|Yes| C
    S -->|No| T[Stop: Max Steps Reached]

    L --> U[Return Final Result]
    Q --> U
    R --> U
    T --> U
    U --> V[Process Exit]

    style A fill:#e1f5fe
    style U fill:#c8e6c9
    style V fill:#ffcdd2
    style D fill:#fff3e0
    style G fill:#f3e5f5
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
