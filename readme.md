# Agent Loop - Coding Agent

## Overview

This project is a simple coding agent implemented with an Agent Loop architecture.

It runs OpenAI LLM calls in a loop and depending on the response, it can read files, search the repo, write patches, run commands, and evaluate work quality. The agent continues this loop until it reaches a final answer or a maximum number of iterations.

## Key Features

- **Manual Tool Calls**: Uses manual tool calls instead of OpenAI function calling for more control
- **Dual Patch Formats**: Supports both full-file patches (for new files) and unified diff patches (for incremental improvements)
- **AST-Based Refactoring**: Advanced TypeScript refactoring using the TypeScript compiler API for symbol renaming, import management, and structural changes
- **Structured Patch Generation**: Generate precise patches from natural language instructions with line-specific edits
- **Work Evaluation**: Built-in evaluation tool that analyzes created files and provides structured feedback with scores, strengths, improvements, and specific suggestions
- **Diff Parsing**: Unified diff patch parsing with comprehensive error handling
- **Iterative Workflow**: Agent follows a structured workflow: create → evaluate → improve with diff patches → re-evaluate

## Tools Available

1. **read_files**: Read and analyze existing files
2. **search_repo**: Search the repository for patterns or content
3. **write_patch**: Apply patches in unified diff format (preferred) or full-file format
4. **generate_patch**: Generate structured patches from natural language instructions
5. **ast_refactor**: Perform AST-based refactoring operations using TypeScript compiler API
6. **run_cmd**: Execute shell commands
7. **evaluate_work**: Analyze files and provide structured feedback for improvements
8. **final_answer**: Complete the task and generate a summary

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
        K[generate_patch]
        L[ast_refactor]
        M[run_cmd]
        N[evaluate_work]
    end
    
    D -.-> H
    D -.-> I
    D -.-> J
    D -.-> K
    D -.-> L
    D -.-> M
    D -.-> N
    
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
    style M fill:#f0f8ff
    style N fill:#f0f8ff
```

## Detailed Architecture Diagram

```mermaid
flowchart TD
    A[Start Agent] --> B[Initialize Config & Reset Token Stats]
    B --> C[Setup Safety Caps & Transcript]
    C --> D[Step Counter: 1 to maxSteps]
    D --> E[Make OpenAI API Call with Retries]
    
    E --> F{API Call Success?}
    F -->|Failed| G[Log Error & Return with Token Stats]
    F -->|Success| H[Parse JSON Response]
    
    H --> I{Parse Success?}
    I -->|Parse Error| J[Default to final_answer]
    I -->|Success| K{Decision Type?}
    
    K -->|read_files| L[Read Files Handler]
    K -->|search_repo| M[Search Repository Handler]
    K -->|write_patch| N[Write Patch Handler]
    K -->|generate_patch| O[Generate Patch Handler]
    K -->|ast_refactor| P[AST Refactor Handler]
    K -->|run_cmd| Q[Run Command Handler]
    K -->|evaluate_work| R[Evaluate Work Handler]
    K -->|final_answer| S[Generate Summary with OpenAI]
    K -->|unknown| T[Log Error & Add to Transcript]
    
    L --> U[Update Transcript with Results]
    M --> U
    N --> V{Check Write Limit}
    O --> W{Check Write Limit}
    P --> X{Check Write Limit}
    Q --> Y{Check Command Limit}
    R --> Z[Analyze Files & Generate Structured Feedback]
    T --> U
    
    V -->|Within Limit| U
    V -->|Exceeded| AA[Stop: Write Limit Reached]
    W -->|Within Limit| U
    W -->|Exceeded| AA
    X -->|Within Limit| U
    X -->|Exceeded| AA
    Y -->|Within Limit| U
    Y -->|Exceeded| BB[Stop: Command Limit Reached]
    
    Z --> CC[Add Evaluation Results to Transcript]
    CC --> U
    
    U --> DD{Step < maxSteps?}
    DD -->|Yes| D
    DD -->|No| EE[Stop: Max Steps Reached]
    
    S --> FF[Display Token Summary & Return Result]
    AA --> FF
    BB --> FF
    EE --> FF
    G --> FF
    FF --> GG[Process Exit]
    
    style A fill:#e1f5fe
    style FF fill:#c8e6c9
    style GG fill:#ffcdd2
    style E fill:#fff3e0
    style K fill:#f3e5f5
    style R fill:#e8f5e8
    style Z fill:#e8f5e8
    style CC fill:#e8f5e8
    style V fill:#fff9c4
    style W fill:#fff9c4
    style X fill:#fff9c4
    style Y fill:#fff9c4
    style O fill:#f0f8ff
    style P fill:#f0f8ff
```

## C4 Model Architecture

### System Context Diagram

```mermaid
C4Context
    title System Context Diagram for Agent Loop

    Person(developer, "Developer", "Software developer using the agent")
    System(agent_loop, "Agent Loop", "AI-powered coding agent that iteratively edits repositories")
    System_Ext(openai, "OpenAI API", "GPT models for decision making and code generation")
    System_Ext(filesystem, "File System", "Local repository files and directories")
    System_Ext(shell, "Shell/CLI", "Command execution environment")

    Rel(developer, agent_loop, "Provides coding tasks and goals")
    Rel(agent_loop, openai, "Makes API calls for decisions and summaries")
    Rel(agent_loop, filesystem, "Reads, writes, and searches files")
    Rel(agent_loop, shell, "Executes commands and runs tests")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### Container Diagram

```mermaid
C4Container
    title Container Diagram for Agent Loop

    Person(developer, "Developer", "Software developer")
    
    System_Boundary(agent_system, "Agent Loop System") {
        Container(cli, "CLI Interface", "Node.js CLI", "Handles user interaction and configuration")
        Container(agent_core, "Agent Core", "TypeScript", "Main agent loop and decision orchestration")
        Container(ai_client, "AI Client", "TypeScript", "OpenAI API integration and token management")
        Container(handlers, "Tool Handlers", "TypeScript", "Executes specific tools (read, write, search, etc.)")
        Container(tools, "Tools Library", "TypeScript", "Core tool implementations (AST, patches, evaluation)")
        Container(utils, "Utilities", "TypeScript", "Logging, validation, and helper functions")
    }

    System_Ext(openai, "OpenAI API", "GPT models")
    SystemDb(filesystem, "File System", "Repository files")
    System_Ext(shell, "Shell Environment", "Command execution")

    Rel(developer, cli, "Provides tasks and configuration")
    Rel(cli, agent_core, "Initiates agent execution")
    Rel(agent_core, ai_client, "Makes LLM decisions")
    Rel(agent_core, handlers, "Delegates tool execution")
    Rel(handlers, tools, "Uses tool implementations")
    Rel(agent_core, utils, "Logging and validation")
    Rel(ai_client, openai, "API calls")
    Rel(handlers, filesystem, "File operations")
    Rel(handlers, shell, "Command execution")

    UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

### Component Diagram - Agent Core

```mermaid
C4Component
    title Component Diagram - Agent Core

    Container_Boundary(agent_core, "Agent Core") {
        Component(agent_loop, "Agent Loop", "TypeScript", "Main execution loop with step management")
        Component(decision_parser, "Decision Parser", "TypeScript", "Parses and validates LLM responses")
        Component(transcript_manager, "Transcript Manager", "TypeScript", "Manages conversation context")
        Component(safety_caps, "Safety Caps", "TypeScript", "Enforces write and command limits")
        Component(token_tracker, "Token Tracker", "TypeScript", "Monitors API usage and costs")
    }

    Container(ai_client, "AI Client", "TypeScript", "OpenAI integration")
    Container(handlers, "Tool Handlers", "TypeScript", "Tool execution")
    Container(utils, "Utilities", "TypeScript", "Logging and helpers")

    Rel(agent_loop, decision_parser, "Validates decisions")
    Rel(agent_loop, transcript_manager, "Updates context")
    Rel(agent_loop, safety_caps, "Checks limits")
    Rel(agent_loop, token_tracker, "Tracks usage")
    Rel(agent_loop, ai_client, "Makes API calls")
    Rel(agent_loop, handlers, "Executes tools")
    Rel(agent_loop, utils, "Logging")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### Component Diagram - Tools and Handlers

```mermaid
C4Component
    title Component Diagram - Tools and Handlers

    Container_Boundary(handlers, "Tool Handlers") {
        Component(file_handler, "File Handler", "TypeScript", "read_files, search_repo operations")
        Component(patch_handler, "Patch Handler", "TypeScript", "write_patch, generate_patch operations")
        Component(ast_handler, "AST Handler", "TypeScript", "ast_refactor operations")
        Component(command_handler, "Command Handler", "TypeScript", "run_cmd operations")
        Component(eval_handler, "Evaluation Handler", "TypeScript", "evaluate_work operations")
    }

    Container_Boundary(tools, "Tools Library") {
        Component(file_ops, "File Operations", "TypeScript", "File reading and searching")
        Component(patch_gen, "Patch Generator", "TypeScript", "Structured patch generation")
        Component(ast_builder, "AST Plan Builder", "TypeScript", "TypeScript AST manipulation")
        Component(cmd_exec, "Command Execution", "TypeScript", "Shell command execution")
        Component(evaluator, "Work Evaluator", "TypeScript", "Code quality assessment")
    }

    SystemDb(filesystem, "File System", "Repository files")
    System_Ext(shell, "Shell Environment", "Command execution")
    System_Ext(ts_compiler, "TypeScript Compiler", "AST parsing and manipulation")

    Rel(file_handler, file_ops, "Uses file operations")
    Rel(patch_handler, patch_gen, "Uses patch generation")
    Rel(ast_handler, ast_builder, "Uses AST manipulation")
    Rel(command_handler, cmd_exec, "Uses command execution")
    Rel(eval_handler, evaluator, "Uses evaluation logic")

    Rel(file_ops, filesystem, "Reads/writes files")
    Rel(patch_gen, filesystem, "Applies patches")
    Rel(ast_builder, ts_compiler, "Parses TypeScript")
    Rel(ast_builder, filesystem, "Writes refactored code")
    Rel(cmd_exec, shell, "Executes commands")
    Rel(evaluator, filesystem, "Reads files for evaluation")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
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


