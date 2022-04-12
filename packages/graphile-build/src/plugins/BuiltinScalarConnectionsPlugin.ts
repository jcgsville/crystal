import "./ConnectionPlugin";

import type { Plugin } from "graphile-plugin";

import { version } from "../index.js";

export const BuiltinScalarConnectionsPlugin: Plugin = {
  name: "BuiltinScalarConnectionsPlugin",
  description: "Adds connection types for builtin scalars",
  version,
  schema: {
    hooks: {
      init(_, build) {
        if (!build.registerCursorConnection) {
          return _;
        }
        build.registerCursorConnection({
          typeName: "Boolean",
          nonNullNode: false,
        });
        build.registerCursorConnection({
          typeName: "Int",
          nonNullNode: false,
        });
        build.registerCursorConnection({
          typeName: "Float",
          nonNullNode: false,
        });
        build.registerCursorConnection({
          typeName: "String",
          nonNullNode: false,
        });
        build.registerCursorConnection({
          typeName: "ID",
          nonNullNode: false,
        });
        return _;
      },
    },
  },
};