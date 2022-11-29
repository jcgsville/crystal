---
title: Introduction
---

# PostGraphile Introduction

:::tip

Coming from PostGraphile Version 4? Check out the
[migration guide](./migrating-from-v4/index.md)!

:::

If you already use PostgreSQL then you understand the value that a strongly
typed and well defined schema can bring to application development; GraphQL is
the perfect match for this technology when it comes to making your data layer
accessible to your frontend application developers (or even API clients).

PostGraphile uses automation and intelligent defaults to eradicate the time
consuming and repetitive parts of building a best practices GraphQL API, whilst
giving you the tools you need to customize and extend your schema to be exactly
what you need. And because it's powered by [Gra*fast*](https://grafast.org) it's
extremely unlikely that you'd be able to build a GraphQL API using traditional
GraphQL/DataLoader patterns that's anywhere near as fast as a PostGraphile API -
it truly runs rings around traditional API development practices.

Built on a [plugin system](./extending), you can easily pick and choose the
features that you want in your API (and even develop your own or mix in features
[from the community](./community-plugins)). Using the
[smart tags system](./smart-tags) you can easily tweak which entities appear,
and how they're exposed. If you ultimately decide an auto-generated GraphQL API
may not be for you, PostGraphile has an ['export' feature](./exporting-schema)
so your generated API can be exported as executable JavaScript code which you
can then maintain yourself ─ there's no lock-in.

:::tip

PostGraphile doesn't have to be (and _generally_ should not be) a 1-to-1 map of
your database. PostGraphile will automatically reflect the permissions in your
database and only expose the tables, columns, functions and mutations that are
granted to it; but you should use [smart tags](./smart-tags) and similar
techniques to hone the GraphQL API to your needs.

We strongly advise that you start with as small a GraphQL API as you can, and
then add features to it as you need them, rather than going for a "kitchen sink"
approach!

:::

If your company needs a GraphQL API and the data the API serves comes mostly
(but not exclusively!) from PostgreSQL databases then PostGraphile can help you
craft your perfect GraphQL API in a matter of days, if not hours; saving you
weeks if not months of development time.

For databases that already use
[row-level security](https://learn.graphile.org/docs/PostgreSQL_Row_Level_Security_Infosheet.pdf)
you might be able to build a secure, performant and extensible GraphQL API in
mere minutes; however, row-level security is not required to secure your
PostGraphile API ─ there are other options for authorization. (TODO: detail
these options!)

_If you are new to GraphQL we recommend you read through the official
introduction to GraphQL [here](https://graphql.org/learn/) before continuing
through the PostGraphile documentation._

Some of the features we offer:

- [Incredible performance](./performance/) - even for your custom logic!
- Full GraphQL feature-set, including advanced topics such as:
  - polymorphism (interfaces and unions)
  - [Real-time](./realtime/) features (subscriptions and soon: live queries)
  - `@stream` / `@defer` support
- Massively reduced load on your database (and other data stores!)
- Integrates with any authentication middleware available in Node.
- Easily add fields and mutations via [JS/TS plugins](./extending/) or
  [database functions](./functions)
- Written in pure TypeScript - no binary modules!
- Export your executable schema as JavaScript
- Very fast startup in serverless
- Bring your own PostgreSQL driver/adaptor
- Run as a CLI, as a Node.js middleware, or a standalone GraphQL schema
- Easy customization via [smart tags](./smart-tags)
- Insight into your operations ("explain") via [Ruru](https://grafast.org/ruru/)
- [Auto-discovered relations](./relations/)
- [Automatic CRUD mutations](./crud-mutations/) e.g. `updatePost`
- Incredible versatility via a wide array of plugins:
  - Aggregation
  - Powerful filtering
  - Soft deletion
  - Upsert
  - Many-to-many navigation
  - Ordering by related tables
  - Multi-tenancy
  - PostGIS
  - And many many more...

The easiest way to get started is with the [CLI interface](./usage-cli/); if you
have `npx` installed you can try it out with:

```
npx postgraphile -P postgraphile/presets/amber -e -c 'postgres:///mydb'
```

(replacing the connection string with a PostgreSQL connection string to your
database)