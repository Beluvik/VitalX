/**
 * A tiny in-process stand-in for D1, used only by tests. It supports exactly
 * the statement shapes db.ts issues (parameterised SELECT/INSERT/UPDATE/
 * DELETE, INSERT ... ON CONFLICT, INSERT OR IGNORE, COUNT(*)), which is
 * enough to exercise every query in db.ts against real, mutating tables
 * rather than mocked return values.
 *
 * This tests db.ts's query logic; it does not prove the real D1/SQLite
 * engine parses every statement identically. schema.test.ts checks
 * schema.sql (what you actually run against real D1) matches SCHEMA here.
 */
import type { D1Database, D1PreparedStatement, D1Result } from './db';

type Row = Record<string, unknown>;

export function createFakeD1(): D1Database {
  const tables: Record<string, Row[]> = {
    users: [], sessions: [], workouts: [], follows: [], likes: [],
    health_profiles: [], day_logs: [], food_logs: [], routines: [], recipes: [], custom_exercises: [], badges: [],
  };

  function run(sql: string, args: unknown[]): { rows: Row[]; changes: number } {
    const s = sql.replace(/\s+/g, ' ').trim();

    let m = s.match(/^SELECT (.+) FROM (\w+)(?: (?!WHERE\b|ORDER\b|LIMIT\b|JOIN\b)(\w+))?(.*)$/i);
    if (m) return { rows: select(m, args), changes: 0 };

    m = s.match(/^INSERT (OR IGNORE )?INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)(?: ON CONFLICT\(([\w, ]+)\) DO UPDATE SET (.+?)(?: WHERE (.+))?)?$/i);
    if (m) return insert(m, args);

    m = s.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
    if (m) return update(m, args);

    m = s.match(/^DELETE FROM (\w+) WHERE (.+)$/i);
    if (m) return del(m, args);

    throw new Error(`fakeD1: unsupported SQL: ${s}`);
  }

  function matchWhere(row: Row, whereSql: string, args: unknown[], argStart: number): boolean {
    // Handles "a = ? AND b = ?", "a = ? AND b > 1" (literal ints), etc.
    const parts = whereSql.split(/\s+AND\s+/i);
    let ai = argStart;
    for (const part of parts) {
      const cm = part.match(/^(\w+)\s*(>=|<=|=|>|<)\s*(\?|-?\d+)$/);
      if (!cm) throw new Error(`fakeD1: unsupported WHERE clause: ${part}`);
      const [, col, op, rhs] = cm;
      const val = rhs === '?' ? args[ai++] : parseInt(rhs, 10);
      const cell = row[col];
      if (op === '=' && cell !== val) return false;
      if (op === '>' && !((cell as number) > (val as number))) return false;
      if (op === '<' && !((cell as number) < (val as number))) return false;
      if (op === '>=' && !((cell as number) >= (val as number))) return false;
      if (op === '<=' && !((cell as number) <= (val as number))) return false;
    }
    return true;
  }

  function select(m: RegExpMatchArray, args: unknown[]): Row[] {
    const [, colsRaw, table, alias, rest] = m;
    const t = tables[table];
    if (!t) throw new Error(`fakeD1: unknown table ${table}`);

    // JOIN follows f ON f.followed_id = w.user_id  (only join this codebase uses)
    let joined: { row: Row; other: Row }[] | null = null;
    let r = rest;
    const joinM = r.match(/^\s*JOIN (\w+) (\w+) ON (\w+)\.(\w+) = (\w+)\.(\w+)(.*)$/i);
    if (joinM) {
      const [, jTable, jAlias, aA, aCol, bA, bCol, tail] = joinM;
      const other = tables[jTable];
      joined = [];
      for (const row of t) {
        for (const orow of other) {
          const left = aA === alias ? row[aCol] : orow[aCol];
          const right = bA === alias ? row[bCol] : orow[bCol];
          if (left === right) joined.push({ row, other: orow });
        }
      }
      r = tail;
    }

    let whereSql = '';
    let orderCol: string | null = null;
    let orderDesc = false;
    let limit: number | null = null;
    const wm = r.match(/^\s*WHERE (.+?)(?: ORDER BY (\w+(?:\.\w+)?) (ASC|DESC))?(?: LIMIT (\?|\d+))?\s*$/i);
    if (wm) {
      whereSql = wm[1];
      if (wm[2]) orderCol = wm[2].split('.').pop() as string;
      orderDesc = wm[3]?.toUpperCase() === 'DESC';
      if (wm[4]) limit = wm[4] === '?' ? (args[args.length - 1] as number) : parseInt(wm[4], 10);
    } else {
      const om = r.match(/^\s*ORDER BY (\w+(?:\.\w+)?) (ASC|DESC)(?: LIMIT (\?|\d+))?\s*$/i);
      if (om) {
        orderCol = om[1].split('.').pop() as string;
        orderDesc = om[2].toUpperCase() === 'DESC';
        if (om[3]) limit = om[3] === '?' ? (args[args.length - 1] as number) : parseInt(om[3], 10);
      }
    }

    let rows: Row[];
    if (joined) {
      const wclauses = whereSql ? whereSql.split(/\s+AND\s+/i) : [];
      rows = joined
        .filter(({ row, other }) => {
          // Every row is tested against the SAME bound arguments (they are
          // the query's parameters, not per-row), so the placeholder counter
          // must restart for each row, not keep advancing across rows.
          let ai = 0;
          for (const clause of wclauses) {
            const cm = clause.match(/^(\w+)\.(\w+)\s*(=|<|>)\s*(\?|-?\d+)$/);
            if (!cm) throw new Error(`fakeD1: unsupported join WHERE: ${clause}`);
            const [, a, col, op, rhs] = cm;
            const cell = a === alias ? row[col] : other[col];
            const val = rhs === '?' ? args[ai++] : parseInt(rhs, 10);
            if (op === '=' && cell !== val) return false;
            if (op === '<' && !((cell as number) < (val as number))) return false;
            if (op === '>' && !((cell as number) > (val as number))) return false;
          }
          return true;
        })
        .map(({ row }) => row);
    } else if (colsRaw.trim() === 'COUNT(*) as n') {
      const count = t.filter((row) => matchWhere(row, whereSql, args, 0)).length;
      return [{ n: count }];
    } else {
      rows = whereSql ? t.filter((row) => matchWhere(row, whereSql, args, 0)) : [...t];
    }

    if (orderCol) {
      rows = [...rows].sort((a, b) => ((a[orderCol as string] as number) - (b[orderCol as string] as number)) * (orderDesc ? -1 : 1));
    }
    if (limit !== null) rows = rows.slice(0, limit);
    return rows.map((r2) => ({ ...r2 }));
  }

  function insert(m: RegExpMatchArray, args: unknown[]) {
    const [, orIgnore, table, colsRaw, valsRaw, conflictCol, updateSetRaw, updateWhereRaw] = m;
    const cols = colsRaw.split(',').map((c) => c.trim());
    const placeholders = valsRaw.split(',').map((v) => v.trim());
    const t = tables[table];
    if (!t) throw new Error(`fakeD1: unknown table ${table}`);

    const row: Row = {};
    placeholders.forEach((p, i) => {
      if (p === '?') row[cols[i]] = args[i];
      else if (/^-?\d+$/.test(p)) row[cols[i]] = parseInt(p, 10); // literal int, e.g. "is_public) VALUES (..., 0, ...)"
      else row[cols[i]] = p.replace(/^'|'$/g, ''); // literal string, e.g. "''"
    });

    const pkCandidates = table === 'users' ? ['id'] : table === 'workouts' ? ['id'] : table === 'sessions' ? ['token'] : cols;
    const pk = conflictCol ? conflictCol.split(',').map((c) => c.trim()) : table === 'follows' ? ['follower_id', 'followed_id'] : table === 'likes' ? ['user_id', 'workout_id'] : pkCandidates;
    const existingIdx = t.findIndex((r2) => pk.every((k) => r2[k] === row[k]));

    if (existingIdx >= 0) {
      if (orIgnore) return { rows: [], changes: 0 };
      if (updateSetRaw) {
        // "col = excluded.col, ..." with args already consumed above; extra
        // args for the WHERE guard (e.g. "WHERE workouts.user_id = ?") come next.
        const sets = updateSetRaw.split(',').map((s) => s.trim());
        let extraArgIdx = placeholders.length;
        if (updateWhereRaw) {
          // Either "table.col = ?" (an ownership guard, one extra arg) or
          // "table.col <= excluded.col" (only overwrite with something newer).
          const wm = updateWhereRaw.match(/^\w+\.(\w+) = \?$/);
          const newer = updateWhereRaw.match(/^\w+\.(\w+) <= excluded\.(\w+)$/);
          if (wm) {
            if (t[existingIdx][wm[1]] !== args[extraArgIdx]) return { rows: [], changes: 0 };
            extraArgIdx++;
          } else if (newer) {
            if (!((t[existingIdx][newer[1]] as number) <= (row[newer[2]] as number))) return { rows: [], changes: 0 };
          } else {
            throw new Error(`fakeD1: unsupported ON CONFLICT guard: ${updateWhereRaw}`);
          }
        }
        for (const set of sets) {
          const sm = set.match(/^(\w+) = excluded\.(\w+)$/);
          if (sm) t[existingIdx][sm[1]] = row[sm[2]];
        }
        return { rows: [], changes: 1 };
      }
      throw new Error(`fakeD1: duplicate key in ${table} with no ON CONFLICT`);
    }
    t.push(row);
    return { rows: [], changes: 1 };
  }

  function update(m: RegExpMatchArray, args: unknown[]) {
    const [, table, setRaw, whereRaw] = m;
    const t = tables[table];
    const sets = setRaw.split(',').map((s) => s.trim());
    let ai = 0;
    const values = sets.map(() => args[ai++]);
    const whereArgStart = ai;
    let changes = 0;
    for (const row of t) {
      if (matchWhere(row, whereRaw, args, whereArgStart)) {
        sets.forEach((s, i) => {
          const col = s.split('=')[0].trim();
          row[col] = values[i];
        });
        changes++;
      }
    }
    return { rows: [], changes };
  }

  function del(m: RegExpMatchArray, args: unknown[]) {
    const [, table, whereRaw] = m;
    const t = tables[table];
    const before = t.length;
    const keep = t.filter((row) => !matchWhere(row, whereRaw, args, 0));
    tables[table] = keep;
    // cascade: mimic ON DELETE CASCADE for the two relations tests rely on
    if (table === 'users') {
      const removedIds = t.filter((row) => !keep.includes(row)).map((row) => row.id);
      tables.sessions = tables.sessions.filter((s) => !removedIds.includes(s.user_id));
      tables.workouts = tables.workouts.filter((w) => !removedIds.includes(w.user_id));
    }
    if (table === 'workouts') {
      const removedIds = t.filter((row) => !keep.includes(row)).map((row) => row.id);
      tables.likes = tables.likes.filter((l) => !removedIds.includes(l.workout_id));
    }
    return { rows: [], changes: before - keep.length };
  }

  function statement(sql: string, boundArgs: unknown[] = []): D1PreparedStatement {
    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        return statement(sql, values);
      },
      async first<T>() {
        const { rows } = run(sql, boundArgs);
        return (rows[0] as T) ?? null;
      },
      async all<T>() {
        const { rows } = run(sql, boundArgs);
        return { results: rows as T[], success: true };
      },
      async run() {
        const { changes } = run(sql, boundArgs);
        return { success: true, meta: { changes, last_row_id: 0 } };
      },
    };
    return stmt;
  }

  return {
    prepare: (sql: string) => statement(sql),
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = [];
      for (const s of statements) out.push(await s.all<T>());
      return out;
    },
  };
}

/** Direct access for test assertions/setup that don't go through db.ts. */
export function dumpTable(database: D1Database, table: string): Row[] {
  return (database as any).__tables?.[table] ?? [];
}
