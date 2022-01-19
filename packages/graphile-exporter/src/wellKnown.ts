import crypto from "crypto";
// eslint-disable-next-line @typescript-eslint/no-duplicate-imports
import * as _crypto from "crypto";
import * as crystalStar from "graphile-crystal";
import * as graphqlStar from "graphql";
import util, * as utilStar from "util";

interface $$Export {
  moduleName: string;
  exportName: string | "default" | "*" | string[];
}

const wellKnownMap = new Map<unknown, $$Export>();

function exportAll(obj: object, moduleName: string) {
  for (const exportName of Object.keys(obj)) {
    if (exportName !== "default" && !wellKnownMap.has(obj[exportName])) {
      wellKnownMap.set(obj[exportName], {
        moduleName,
        exportName,
      });
    }
  }
}

// TODO: fill this out a bit...
wellKnownMap.set(crypto, { moduleName: "crypto", exportName: "default" });
wellKnownMap.set(util, { moduleName: "util", exportName: "default" });
exportAll(crystalStar, "graphile-crystal");
exportAll(graphqlStar, "graphql");
exportAll(utilStar, "util");

const namespaces = Object.assign(Object.create(null), { crypto: _crypto });

/**
 * Determines if the thing is something well known (like a Node.js builtin); if
 * so, returns the export description of it.
 *
 * @internal
 */
export function wellKnown(thing: unknown): $$Export | undefined {
  // Straight imports are relatively easy:
  const simple = wellKnownMap.get(thing);
  if (simple) {
    return simple;
  }

  // Checking for namespace matches is a bit tougher
  for (const moduleName in namespaces) {
    if (isSameNamespace(thing, namespaces[moduleName])) {
      return { moduleName, exportName: "*" };
    }
  }

  return undefined;
}

function isSameNamespace<TNamespace>(
  thing: unknown,
  namespace: TNamespace,
): thing is TNamespace {
  if (typeof thing !== "object" || thing == null) {
    return false;
  }
  const thingKeys = Object.keys(thing);
  const nspKeys = Object.keys(namespace);
  if (thingKeys.length !== nspKeys.length) {
    return false;
  }
  for (const key of nspKeys) {
    if (thing[key] !== namespace[key]) {
      return false;
    }
  }
  return true;
}