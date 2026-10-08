import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
// Run the production SQL, including aggregate triggers, against real SQLite.
export class TestDB {
  sql = new DatabaseSync(':memory:');
  constructor() {
    for (const file of ['0001_initial.sql', '0002_ai_assessment_history.sql', '0003_explicit_ai_recalibration.sql', '0004_google_login.sql', '0005_saved_songs.sql']) this.sql.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  prepare(query: string) { return new Statement(this, query); }
  async batch(statements: Statement[]) {
    this.sql.exec('BEGIN');
    try { const values = statements.map(statement => statement.execute()); this.sql.exec('COMMIT'); return values; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
class Statement {
  values: any[] = [];
  constructor(public db: TestDB, public query: string) {}
  bind(...values: any[]) { const s = new Statement(this.db, this.query); s.values = values; return s; }
  execute() {
    const statement = this.db.sql.prepare(this.query);
    const results = statement.columns().length ? statement.all(...this.values) : (statement.run(...this.values), []);
    const changes = Number((this.db.sql.prepare('SELECT changes() AS n').get() as { n: number }).n);
    return { results, success: true, meta: { changes } };
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first(key?: string) { const row = this.execute().results[0] || null; return key && row ? row[key] : row; }
}
