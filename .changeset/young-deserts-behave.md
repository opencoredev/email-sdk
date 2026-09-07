---
"@opencoredev/email-sdk": minor
---

Allow CommonJS applications on Node.js `^20.19.0 || >=22.12.0` (20.19+ on 20.x, or 22.12+) to load every SDK entry point with `require()`. ESM imports still support Node.js 20+. Typed CommonJS consumers need TypeScript 5.8+ with `module: nodenext`, or a compiler supporting `module: node20`. On older supported runtimes, use dynamic `import()` instead.
