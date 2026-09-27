# @visitproof/config

Shared configuration for the VisitProof monorepo.

| Export                                            | Purpose                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@visitproof/config` and `@visitproof/config/env` | Zod schema for every variable in `.env.example` (`envSchema`, `parseEnv`)                              |
| `@visitproof/config/prettier`                     | Prettier config (referenced from the root `package.json`)                                              |
| `@visitproof/config/eslint/base`                  | ESLint 9 flat config for plain TypeScript                                                              |
| `@visitproof/config/eslint/node`                  | Base plus Node globals (Lambda handlers, servers)                                                      |
| `@visitproof/config/eslint/next`                  | Next.js apps                                                                                           |
| `@visitproof/config/eslint/react-internal`        | React libraries such as `@workspace/ui`                                                                |
| `@visitproof/config/tsconfig.base.json`           | Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`, `target: ES2022` |
| `@visitproof/config/tsconfig.node.json`           | Base plus Node types, no DOM lib                                                                       |
| `@visitproof/config/tsconfig.nextjs.json`         | Next.js app settings                                                                                   |
| `@visitproof/config/tsconfig.react-library.json`  | React library settings                                                                                 |

Usage in a package `tsconfig.json`:

```json
{ "extends": "@visitproof/config/tsconfig.node.json" }
```
