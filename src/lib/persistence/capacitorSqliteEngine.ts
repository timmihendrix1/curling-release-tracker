// The ONLY file in this repository that names `@capacitor-community/sqlite`.
//
// It binds the plugin's actual shipped API (verified against the published 8.1.1
// tarball) to the narrow `NativeSqliteEngine`/`NativeSqliteConnection` interfaces
// declared in `nativeSqliteAdapter.ts`. Keeping the binding here means the
// adapter's ownership, ordering and error-normalisation logic is testable with a
// plain fake, and that a bundle which never constructs a native store ships no
// SQLite implementation at all — `nativeSqliteAdapter.ts` imports this module
// lazily, and no other production module under `src/` imports either of them
// statically (`__tests__/architectureBoundary.test.ts`).
//
// Nothing here classifies, logs or forwards a plugin error: every rejection
// propagates unchanged into the adapter, which converts it to a fixed, safe
// message without reading it.
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type {
  NativeSqliteConnection,
  NativeSqliteEngine,
  NativeSqliteQueryResult,
} from "./nativeSqliteAdapter";

/** The plugin's own constants for an unencrypted, version-1 read/write
 * connection. Encryption is deliberately not used: it would put a passphrase in
 * scope, and where credentials live is an open decision (ADR-0049, "Deliberately
 * NOT decided here"). */
const ENCRYPTED = false;
const MODE = "no-encryption";
const VERSION = 1;
const READ_ONLY = false;

function wrapConnection(db: SQLiteDBConnection): NativeSqliteConnection {
  return {
    open: () => db.open(),
    close: () => db.close(),
    execute: (statements, transaction) => db.execute(statements, transaction),
    run: (statement, values) => db.run(statement, values),
    query: (statement, values): Promise<NativeSqliteQueryResult> =>
      db.query(statement, values),
  };
}

export function createCapacitorSqliteEngine(): NativeSqliteEngine {
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  return {
    async createConnection(databaseName: string): Promise<NativeSqliteConnection> {
      // The native side keeps its own connection dictionary for the lifetime of
      // the PROCESS, while the JavaScript side's is recreated with every
      // document. After a WebView reload the native entry can therefore survive
      // a page that no longer knows about it, and `createConnection` rejects
      // with "already exists". Releasing first is the documented recovery; when
      // there is nothing to release this rejects and is ignored, which is why
      // the failure is swallowed here and nowhere else.
      try {
        await sqlite.closeConnection(databaseName, READ_ONLY);
      } catch {
        /* no pre-existing connection to release */
      }
      const db = await sqlite.createConnection(
        databaseName,
        ENCRYPTED,
        MODE,
        VERSION,
        READ_ONLY
      );
      return wrapConnection(db);
    },
    closeConnection(databaseName: string): Promise<void> {
      return sqlite.closeConnection(databaseName, READ_ONLY);
    },
  };
}
