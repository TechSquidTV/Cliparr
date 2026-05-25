import { sql } from "drizzle-orm";

export function currentTimestampSql() {
  return sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
}
