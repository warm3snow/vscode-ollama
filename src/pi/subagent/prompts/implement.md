---
description: Full implementation workflow - codebase-search gathers context, plan creates plan, implement executes
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "codebase-search" agent to find all code relevant to: $@
2. Then, use the "plan" agent to create an implementation plan for "$@" using the context from the previous step (use {previous} placeholder)
3. Finally, use the "implement" agent to implement the plan from the previous step (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.
