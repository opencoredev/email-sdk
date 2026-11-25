---
"@opencoredev/email-sdk": minor
---

Add a workflow inspector and CLI. `inspectWorkflow(definition, { input, events, steps })` explores every path a workflow can take without sending anything, forking each timed `waitForEvent` into `received` and `timeout` branches, and returns a JSON graph of rendered emails, delays, event waits, mocked steps, and end states, capped by `maxPaths` and `maxDepth`. `toMermaid` and `formatWorkflowGraph` render it, and `describeRun` turns a stored `WorkflowRun` into a timeline with the current wait and deadline. `email-sdk workflows inspect <module> --export <name> --input <json|@file>` prints the same graph as JSON, Mermaid, or text.
