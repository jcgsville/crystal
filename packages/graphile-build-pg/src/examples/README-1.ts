/* eslint-disable no-restricted-syntax */

import type { WithPgClient } from "@dataplan/pg";
import { makeNodePostgresWithPgClient } from "@dataplan/pg/adaptors/node-postgres";
import chalk from "chalk";
import { readFile } from "fs/promises";
import {
  buildSchema,
  defaultPreset as graphileBuildPreset,
  gather,
  QueryQueryPlugin,
} from "graphile-build";
import { crystalPrint } from "graphile-crystal";
import { exportSchema } from "graphile-exporter";
import { resolvePresets } from "graphile-plugin";
import { graphql, printSchema } from "graphql";
import { Pool } from "pg";
import { inspect } from "util";

import { defaultPreset as graphileBuildPgPreset } from "../index.js";

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

const pool = new Pool({
  connectionString: "pggql_test",
});
const withPgClient: WithPgClient = makeNodePostgresWithPgClient(pool);

(async function () {
  // Create our GraphQL schema by applying all the plugins
  const config = resolvePresets([
    {
      extends: [graphileBuildPreset, graphileBuildPgPreset],
      plugins: [QueryQueryPlugin],
      gather: {
        pgDatabases: [
          {
            name: "main",
            schemas: ["a", "b", "c"],
            pgSettingsKey: "pgSettings",
            withPgClientKey: "withPgClient",
            withPgClient: withPgClient,
          },
        ],
      },
    },
  ]);
  const input = await gather(config);
  console.log(
    input.pgSources.map((s) => crystalPrint((s as any).options)).join("\n"),
  );
  const schema = buildSchema(config, input);

  // Output our schema
  // console.log(chalk.blue(printSchema(schema)));
  console.log();
  console.log();
  console.log();
  const source = /* GraphQL */ `
    {
      allMainAPosts {
        nodes {
          id
        }
      }
    }
  `;
  const rootValue = null;
  const contextValue = {
    withPgClient,
  };
  const variableValues = {};

  // Run our query
  const result = await graphql({
    schema,
    source,
    rootValue,
    variableValues,
    contextValue,
  });
  console.log(inspect(result, { depth: 12, colors: true })); // { data: { random: 4 } }

  if ("errors" in result) {
    process.exit(1);
  }

  // Export schema
  // const exportFileLocation = new URL("../../temp.js", import.meta.url);
  const exportFileLocation = `${__dirname}/../../temp.mjs`;
  await exportSchema(schema, exportFileLocation);

  // output code
  //console.log(chalk.green(await readFile(exportFileLocation, "utf8")));

  // run code
  const { schema: schema2 } = await import(exportFileLocation.toString());
  const result2 = await graphql({
    schema: schema2,
    source,
    rootValue,
    variableValues,
    contextValue,
  });
  console.log(inspect(result2, { depth: 12, colors: true })); // { data: { random: 4 } }
})()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });