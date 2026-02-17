# Development Guidelines

## Code Style & Conventions

- ALWAYS prefer named exports over default exports
- ALWAYS import React using `import * as React from 'react'`, NOT `import React from 'react'`
- Prefer creating React components as arrow functions with const, NOT function declarations
- Except for direct sibling files, prefer using absolute imports from `src` using `@/`

## Components & UI

- Use shadcn components when possible. They're located in `src/components/ui`. New ones can be installed via the `shadcn` MCP
- Only use `src/components/ui` for generic and reusable components, such as the ones from shadcn. When extracting a component for a specific use case, create it in `src/components`
- Use `cn` utility from `@/lib/utils` to compose classNames

## Development Workflow

- Use `pnpm check` after writing code (does type checking, linting and formatting)
- Do not commit for me
