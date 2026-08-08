// Dev-tooling only. `server-only` intentionally throws when required outside
// Next.js's server-component bundler (that's its entire purpose — a guard
// against accidentally shipping server code to the client). Next.js aliases
// it away at build time; plain `tsx` has no such aliasing, so standalone
// scripts like check-openbudget.ts/check-unified.ts that import server-only
// modules (openbudget.ts, db.ts, ...) need this to run at all.
//
// Never referenced by application code or the Next.js build — only by the
// `-r` flag on the check-*.ts scripts.
const Module = require('node:module');
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return __filename;
  return original.call(this, request, ...rest);
};
