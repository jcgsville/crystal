import type { ResolvedPreset } from "graphile-plugin";
import type { GraphQLSchema } from "graphql";
import type { IncomingMessage } from "http";

export type ContextCallback = (req: IncomingMessage) => object;

// TODO: rename this!
export interface SchemaResult {
  schema: GraphQLSchema;
  config: ResolvedPreset;
  contextCallback: ContextCallback;
}

export interface ServerOptions {
  /** Port number to listen on */
  port?: number;

  /** Return settings to set in the session */
  pgSettings?: (req: IncomingMessage) => object;

  /** The path at which GraphQL will be available; usually /graphql */
  graphqlPath?: string;

  graphiql?: boolean;
  /** The path at which GraphiQL will be available; usually / */
  graphiqlPath?: string;

  exposePlan?: boolean;
  /** The path at which the latest plan will be visible; usually /plan */
  planPath?: string;
}

declare module "graphile-plugin" {
  interface Preset {
    server?: ServerOptions;
  }
}