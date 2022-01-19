import "./global.js";

import debugFactory from "debug";
import { EventEmitter } from "events";
import type { GraphQLError, GraphQLSchemaConfig } from "graphql";
import { GraphQLSchema, validateSchema } from "graphql";

import makeNewBuild from "./makeNewBuild.js";
import type { NewWithHooksFunction } from "./newWithHooks/index.js";
import { makeNewWithHooks } from "./newWithHooks/index.js";
import { makeSchemaBuilderHooks } from "./SchemaBuilderHooks.js";
import { bindAll } from "./utils.js";

const debug = debugFactory("graphile-builder");

const INIT_OBJECT: GraphileEngine.InitObject = Object.freeze(
  Object.create(null),
);

const INDENT = "  ";

class SchemaBuilder<
  TBuild extends GraphileEngine.Build = GraphileEngine.Build,
> extends EventEmitter {
  options: GraphileEngine.GraphileBuildSchemaOptions;
  depth: number;
  hooks: GraphileEngine.SchemaBuilderHooks<TBuild>;

  _currentPluginName: string | null | undefined;

  newWithHooks: NewWithHooksFunction;

  constructor(options: GraphileEngine.GraphileBuildSchemaOptions) {
    super();

    if (!options) {
      throw new Error("Please pass options to SchemaBuilder");
    }
    this.options = options;

    // Because hooks can nest, this keeps track of how deep we are.
    this.depth = -1;

    this.hooks = makeSchemaBuilderHooks();

    this.newWithHooks = makeNewWithHooks({ builder: this }).newWithHooks;
  }

  _setPluginName(name: string | null | undefined) {
    this._currentPluginName = name;
  }

  /**
   * Every hook `fn` takes three arguments:
   *
   * - obj - the object currently being inspected
   * - build - the current build object (which contains a number of utilities
   *   and the context of the build)
   * - context - information specific to the current invocation of the hook
   *
   * The function must return a replacement object for `obj` or `obj` itself.
   * Generally we advice that you return the object itself, modifying it as
   * necessary. Modifying the object is significantly faster than returning a
   * clone.
   */
  hook<THookName extends keyof GraphileEngine.SchemaBuilderHooks<TBuild>>(
    hookName: THookName,
    fn: GraphileEngine.SchemaBuilderHooks[THookName][number],
  ): void {
    if (!this.hooks[hookName]) {
      // TODO: fuzzy-find a similar hook
      throw new Error(`Sorry, '${hookName}' is not a supported hook`);
    }
    if (this._currentPluginName) {
      fn.displayName = `${this._currentPluginName}/${hookName}/${
        fn.displayName || fn.name || "unnamed"
      }`;
    }
    this.hooks[hookName].push(fn as any);
  }

  applyHooks<THookName extends keyof GraphileEngine.SchemaBuilderHooks<TBuild>>(
    hookName: THookName,
    input: Parameters<
      GraphileEngine.SchemaBuilderHooks<TBuild>[THookName][number]
    >[0],
    build: Parameters<
      GraphileEngine.SchemaBuilderHooks<TBuild>[THookName][number]
    >[1],
    context: Parameters<
      GraphileEngine.SchemaBuilderHooks<TBuild>[THookName][number]
    >[2],
    debugStr?: string,
  ): Parameters<
    GraphileEngine.SchemaBuilderHooks<TBuild>[THookName][number]
  >[0] {
    if (!input) {
      throw new Error("applyHooks was called with falsy input");
    }
    this.depth++;
    try {
      debug(`${INDENT.repeat(this.depth)}[${hookName}${debugStr}]: Running...`);

      const hooks = this.hooks[hookName];
      if (!hooks) {
        throw new Error(`Sorry, '${hookName}' is not a registered hook`);
      }

      let newObj = input;
      for (const hook of hooks) {
        this.depth++;
        try {
          const hookDisplayName = hook.displayName || hook.name || "anonymous";
          debug(
            `${INDENT.repeat(
              this.depth,
            )}[${hookName}${debugStr}]:   Executing '${hookDisplayName}'`,
          );

          const previousHookName = build.status.currentHookName;
          const previousHookEvent = build.status.currentHookEvent;
          build.status.currentHookName = hookDisplayName;
          build.status.currentHookEvent = hookName;
          const oldObj = newObj;
          newObj = hook(newObj as any, build as any, context as any);
          if (hookName === "build") {
            /*
             * Unlike all the other hooks, the `build` hook must always use the
             * same `build` object - never returning a new object for fear of
             * causing issues to other build hooks that reference the old
             * object and don't get the new additions.
             */
            if (newObj !== oldObj) {
              throw new Error(
                `Build hook '${hookDisplayName}' returned a new object; 'build' hooks must always return the same Build object - please use 'return build.extend(build, {...})' instead.`,
              );
            }
          }
          build.status.currentHookName = previousHookName;
          build.status.currentHookEvent = previousHookEvent;

          if (!newObj) {
            throw new Error(
              `GraphileEngine.Hook '${
                hook.displayName || hook.name || "anonymous"
              }' for '${hookName}' returned falsy value '${newObj}'`,
            );
          }
          debug(
            `${INDENT.repeat(
              this.depth,
            )}[${hookName}${debugStr}]:   '${hookDisplayName}' complete`,
          );
        } finally {
          this.depth--;
        }
      }

      debug(`${INDENT.repeat(this.depth)}[${hookName}${debugStr}]: Complete`);

      return newObj;
    } finally {
      this.depth--;
    }
  }

  createBuild(input: GraphileEngine.BuildInput): TBuild {
    const initialBuild = makeNewBuild(this, input) as Partial<TBuild> &
      GraphileEngine.BuildBase;
    // Inflection needs to come first, in case 'build' hooks depend on it
    const scopeContext: GraphileEngine.ContextInflection = {
      scope: {},
      type: "inflection",
    };
    initialBuild.inflection = this.applyHooks(
      "inflection",
      initialBuild.inflection,
      initialBuild,
      scopeContext,
    ) as GraphileEngine.Inflection;

    const build = this.applyHooks("build", initialBuild, initialBuild, {
      scope: {},
      type: "build",
    });

    // Bind all functions so they can be dereferenced
    bindAll(
      build,
      Object.keys(build).filter((key) => typeof build[key] === "function"),
    );

    const finalBuild = Object.freeze(build) as TBuild;
    const initContext: GraphileEngine.ContextInit = { scope: {}, type: "init" };
    this.applyHooks("init", INIT_OBJECT, finalBuild, initContext);
    return finalBuild;
  }

  buildSchema(input: GraphileEngine.BuildInput): GraphQLSchema {
    const build = this.createBuild(input);
    const schemaSpec: Partial<GraphQLSchemaConfig> = {
      directives: [...build.graphql.specifiedDirectives],
    };
    const schemaScope: GraphileEngine.ScopeGraphQLSchema = {
      __origin: `Graphile built-in`,
    };
    const tempSchema = this.newWithHooks(
      build,
      GraphQLSchema,
      schemaSpec,
      schemaScope,
    );

    const finalizeContext: GraphileEngine.ContextFinalize = {
      scope: {},
      type: "finalize",
    };

    const schema = tempSchema
      ? this.applyHooks(
          "finalize",
          tempSchema,
          build,
          finalizeContext,
          "Finalizing GraphQL schema",
        )
      : tempSchema;

    if (!schema) {
      throw new Error("Schema generation failed");
    }

    const validationErrors = validateSchema(schema);
    if (validationErrors.length) {
      throw new AggregateError(
        validationErrors,
        `Schema construction failed due to ${
          validationErrors.length
        } validation failure(s). First failure was: ${String(
          validationErrors[0],
        )}`,
      );
    }

    return schema;
  }
}

export default SchemaBuilder;