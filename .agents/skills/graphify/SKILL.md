---
name: graphify
description: "Codebase structural knowledge graph tool that maps code AST, imports, file relationships, function definitions, and architecture dependencies into a queryable graph."
---

# Graphify - Codebase Knowledge Graph & AST Navigator

Graphify turns the codebase into a queryable knowledge graph to map architectural dependencies, function calls, and import trees deterministically.

## Core Capabilities
- **AST Dependency Graphing**: Analyzes imports, component trees, and module exports across TypeScript, JavaScript, CSS, and database schemas.
- **Structural Tracing**: Traces data flow from API/DB layers to React components without hallucinating file paths.
- **Traceable Graph Outputs**: Output graph files are stored in `graphify-out/` or knowledge items for fast reference.

## Usage & Execution Guidelines
1. **Explore Structure**: Before performing major refactoring or large feature additions, consult the knowledge graph or inspect module entry points to understand component trees.
2. **Map Relationships**: Verify import paths, prop types, and state flow between components.
3. **No Hallucinated Imports**: Always verify that exported symbols and file paths exist before editing references.
