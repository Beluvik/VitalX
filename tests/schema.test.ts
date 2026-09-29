/**
 * Checks schema.sql (what you actually run against real D1) still matches
 * SCHEMA in db.ts (what the tests are written against). If these drift, the
 * tests would pass against a database that doesn't exist.
 */
declare const require: (id: string) => any;
declare const process: { cwd(): string };
const fs: { readFileSync(path: string, enc: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');
import { SCHEMA } from '../backend/src/db';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const fileSql = fs.readFileSync(path.join(process.cwd(), 'backend', 'schema.sql'), 'utf8');

check('schema.sql contains the same statements as db.ts SCHEMA', norm(fileSql).includes(norm(SCHEMA)));
for (const table of ['users', 'sessions', 'workouts', 'follows', 'likes', 'health_profiles', 'day_logs', 'food_logs', 'routines', 'recipes', 'custom_exercises', 'badges']) {
  check(`schema.sql creates the ${table} table`, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(fileSql));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
