# Order consistency

The API canonicalizes a cart into sorted unique meal IDs and integer quantities. A SHA-256 fingerprint combines that cart with the pickup name. Inside BEGIN IMMEDIATE, the engine first checks the request key, then validates inventory, computes authoritative prices, inserts the order and lines, and decrements stock. An exception rolls back the entire transaction.

A replay returns the existing order's current state. The key and fingerprint are stored in SQLite, so retry protection survives server restarts. The UI holds its retry key while the cart and pickup name remain unchanged. Reloading the browser loses that client key; recovery across reloads is future work. The API itself accepts the original key indefinitely.

Price snapshots live on order lines. Future menu-price changes therefore must not alter historical receipts. Stock is decremented at receipt, and only a received order can be cancelled. Preparing, ready, and completed orders cannot be cancelled with this model. Real refunds and food waste require a separate ledger rather than silently restoring stock.

Version checks prevent two kitchen tabs from advancing the same stale ticket. Status events provide history, but the local database is not a tamper-proof audit store. SQLite WAL mode and a busy timeout support short transactions. Stop the process before copying database files, or use SQLite online backup tooling.

The API bounds request bodies, uses prepared statements, validates input, and checks origins and hosts. It does not provide account security. Do not expose the default operator endpoints publicly without adding authentication and authorization.

The HTTP infrastructure was shared with the ApplyFlow project in this portfolio; the order transaction model and UI are specific to Dispatch Kitchen.
