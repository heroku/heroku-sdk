# Decision: Defer SQL-Based `pg:*` Commands

**Status:** Deferred
**Date:** 2026-04-27

## Context

The SDK aims to consolidate business logic for interacting with Heroku's remote resources into a consistent, easy-to-use interface. The `pg:*` command family spans two distinct transport mechanisms:

**Platform API (HTTP):** `pg:info`, `pg:credentials`, `pg:maintenance`, `pg:backups`, `pg:upgrade` -- these call Heroku's REST API endpoints and fit cleanly into the SDK's existing HTTP dispatch architecture.

**Direct SQL:** `pg:ps`, `pg:locks`, `pg:outliers`, `pg:kill` -- these execute diagnostic SQL queries directly against a user's Postgres database (e.g., querying `pg_stat_statements`, `pg_locks`). They do not use the Platform API.

Both categories interact with Heroku's remote resources and are candidates for SDK inclusion under our expanded definition of "Heroku Platform." The challenge is that a consistent interface -- one that hides these transport differences from consumers -- requires architectural decisions that carry significant trade-offs.

## Open Questions

1. **Postgres client dependency:** Should the SDK bundle a Postgres client (e.g., the `pg` npm package) as a direct dependency, or should consumers inject a connection/executor? Bundling simplifies consumption but increases the SDK's footprint for users who never call `pg:*` SQL functions.

2. **Connection lifecycle:** Should the SDK manage connection pooling and teardown, or treat each call as one-shot (connect, execute, disconnect)?

3. **Credential resolution:** The SQL commands need a database connection string. Should the SDK auto-resolve this from the Platform API (fetch the DATABASE_URL from app config vars / addon attachments), or require consumers to pass it in? Auto-resolution is more consistent with hiding implementation details but couples the SQL functions to the HTTP transport.

## Decision

Defer the SQL-based `pg:*` commands (`pg:ps`, `pg:locks`, `pg:outliers`, `pg:kill`) from the SDK until the open questions above are resolved through further discussion.

The HTTP-based `pg:*` commands (`pg:info`, `pg:credentials`, `pg:maintenance`, `pg:backups`, `pg:upgrade`) are not affected by this decision and can proceed as planned using the existing dispatch architecture.

## Consequences

- The SQL-based `pg:*` commands will remain duplicated across consumer codebases in the interim.
- The SDK's `pg` resource module can be built incrementally -- ship the HTTP-based functions first, add SQL-based functions once the transport architecture is decided.
- No Postgres client dependency is introduced until a deliberate decision is made.
