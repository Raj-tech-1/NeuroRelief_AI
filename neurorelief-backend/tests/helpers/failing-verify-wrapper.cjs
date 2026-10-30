// REHEARSAL-ONLY stand-in for scripts/verify-report-audit.js. The restore rehearsal copies this file as
// <temp backend dir>\scripts\verify-report-audit.js and points the runner at that temp dir with -BackendDir.
// It ALWAYS runs the real verifier first and forwards its result, with one exception: it can force the POST-SWAP checks
// (the ones that name the swapped-in database) to fail, so the runner's automatic restore can be exercised end to end.
//   NR_REAL_VERIFY  absolute path of the real scripts/verify-report-audit.js
//   NR_FAIL_DB      the disposable database the runner swaps into (compared case-insensitively)
//   NR_FAIL_MODE    '' (no injection: control run) | 'migrations' | 'full' | 'both'
// Pre-swap checks (which name the prepared COPY, not the database) are never altered.
const { spawnSync } = require('child_process')
const path = require('path')
const args = process.argv.slice(2)
const real = spawnSync(process.execPath, [process.env.NR_REAL_VERIFY, ...args], { stdio: 'inherit' })
const db = path.resolve(process.env.NR_FAIL_DB || 'no-such-file').toLowerCase()
const mode = process.env.NR_FAIL_MODE || ''
const names = flag => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] && path.resolve(args[i + 1]).toLowerCase() === db }
const inject = (names('--migrations-only') && /migrations|both/.test(mode)) || (names('--after') && /full|both/.test(mode))
if (inject) {
  console.log('FAIL  INJECTED FAILURE (rehearsal wrapper only): simulated post-swap verification failure')
  process.exit(1)
}
process.exit(real.status === null ? 1 : real.status)
