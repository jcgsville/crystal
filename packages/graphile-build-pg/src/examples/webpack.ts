/* eslint-disable no-restricted-syntax */

import type { WithPgClient } from "@dataplan/pg";
import { makeNodePostgresWithPgClient } from "@dataplan/pg/adaptors/node-postgres";
import chalk from "chalk";
import { crystalPrint, stripAnsi } from "dataplanner";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import { readFile } from "fs/promises";
import {
  buildInflection,
  buildSchema,
  defaultPreset as graphileBuildPreset,
  gather,
  QueryQueryPlugin,
  SwallowErrorsPlugin,
} from "graphile-build";
import { exportSchema } from "graphile-exporter";
import { resolvePresets } from "graphile-plugin";
import { graphql, printSchema } from "graphql";
import * as jsonwebtoken from "jsonwebtoken";
import { Pool } from "pg";
import { inspect } from "util";
import webpack from "webpack";

import { defaultPreset as graphileBuildPgPreset } from "../index.js";

/**
 * Set this to 'false' for production and the bundle will be minified.
 */
const DEBUG_MODE = true;

// Our server will supply pgSettings/withPgClient on the GraphQL context
declare global {
  namespace GraphileEngine {
    interface GraphileResolverContext {
      pgSettings: {
        [key: string]: string;
      } | null;
      withPgClient: WithPgClient;
    }
  }
}

// Create a pool and add the error handler
const pool = new Pool({
  connectionString: "postgres://postgres:unsecured@localhost:6432/chinook",
  // --simple-collections only
});
pool.on("error", (e) => {
  console.log("Client error", e);
});

// We're using the node-postgres adaptor
const withPgClient: WithPgClient = makeNodePostgresWithPgClient(pool);

async function main() {
  // The Graphile configuration
  const config = resolvePresets([
    {
      extends: [graphileBuildPreset, graphileBuildPgPreset],
      plugins: [QueryQueryPlugin, SwallowErrorsPlugin],
      gather: {
        pgDatabases: [
          // Configuration of our main (and only) Postgres database
          {
            name: "main",
            schemas: ["public"],
            pgSettingsKey: "pgSettings",
            withPgClientKey: "withPgClient",
            withPgClient: withPgClient,
          },
        ],
      },
      schema: {
        simpleCollections: "only",
      },
    },
  ]);

  // Inflection phase
  const shared = { inflection: buildInflection(config) };

  // Gather phase
  const input = await gather(config, shared);

  // Schema build phase
  const schema = buildSchema(config, input, shared);

  // Export schema to JavaScript file
  await exportSchema(
    schema,
    `${__dirname}/../../exported-schema-for-webpack.mjs`,
    {
      mode: "graphql-js",
    },
  );

  // Now webpack it
  const finalFileLocation = `${__dirname}/../../webpacked`;
  await new Promise<void>((resolve, reject) => {
    webpack(
      {
        // Node.js
        target: "node",

        // We want the schema bundled up, but also DataPlanner's execute
        // method, etc, so we use an entry file that pulls both in.
        entry: `${__dirname}/webpack-entry-file.js`,

        output: {
          library: {
            // TODO: make this work with ESM!
            type: "commonjs",
          },
          path: finalFileLocation,
        },

        // These things should come from `node_modules` rather than being
        // bundled; this is primarily because we expect you to bring your own
        // GraphQL server. (Also: node builtins.)
        externals: [
          "graphql",
          "util",
          "assert",
          "crypto",
          "fs",
          "fs/promises",
          "inspector",
        ],

        // Production optimisations!
        plugins: [
          new webpack.DefinePlugin({
            "process.env.NODE_ENV": JSON.stringify(
              DEBUG_MODE ? "development" : "production",
            ),
            "process.env.GRAPHILE_ENV": JSON.stringify(
              DEBUG_MODE ? "development" : "production",
            ),
          }),
        ],

        // Minify the resulting code.
        optimization: {
          minimize: DEBUG_MODE ? false : true,
        },
      },
      (err, stats) => {
        if (err) {
          reject(err);
        } else if (stats!.hasErrors()) {
          console.dir(stats!.toJson().errors);
          reject(new Error("Webpack compilation faield"));
        } else {
          resolve();
        }
      },
    );
  });

  // All done!
  console.log(`Schema exported to ${finalFileLocation}`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });