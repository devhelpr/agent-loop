flowchart LR

A[Codebase repo] --> B[AI agent scans repo]
B --> C[Detect modules, classes, functions, and dependencies]
C --> D[Generate structured summary JSON or graph]
D --> E[Convert to Mermaid syntax]
E --> F[Write Markdown with Mermaid diagrams]
F --> G[Render diagrams in GitHub, VS Code, or Notion]
G --> H{Human reviews diagram}
H --> I[AI analyzes structure: cycles, hotspots, refactors]
I --> J[Create action items or pull requests]
J --> K[Refactor or update code]
K --> B

A -. optional .-> L[deepwiki.com for open-source repos]
L -. external docs .-> G

G --> O1[Onboarding maps]
G --> O2[Living documentation]

H -. edit diagram .-> M[Apply diagram edits to code experimental]
M --> K
