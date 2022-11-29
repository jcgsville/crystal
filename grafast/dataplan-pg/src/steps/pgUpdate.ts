import type {
  GrafastResultsList,
  GrafastValuesList,
  SetterStep,
} from "grafast";
import { ExecutableStep, isDev, setter } from "grafast";
import type { SQL, SQLRawValue } from "pg-sql2";
import sql from "pg-sql2";
import { inspect } from "util";

import type { PgTypeColumn, PgTypeColumns } from "../codecs.js";
import type {
  PgSource,
  PgSourceRelation,
  PgSourceRow,
  PgSourceUnique,
} from "../datasource.js";
import type { PgTypeCodec, PlanByUniques } from "../interfaces.js";
import type { PgClassExpressionStep } from "./pgClassExpression.js";
import { pgClassExpression } from "./pgClassExpression.js";

type QueryValueDetailsBySymbol = Map<
  symbol,
  { depId: number; processor: (value: any) => SQLRawValue }
>;

interface PgUpdatePlanFinalizeResults {
  /** The SQL query text */
  text: string;

  /** The values to feed into the query */
  rawSqlValues: ReadonlyArray<SQLRawValue>;

  /** When we see the given symbol in the SQL values, what dependency do we replace it with? */
  queryValueDetailsBySymbol: QueryValueDetailsBySymbol;
}

/**
 * Update a single row identified by the 'getBy' argument.
 */
export class PgUpdateStep<
  TColumns extends PgTypeColumns | undefined,
  TUniques extends ReadonlyArray<PgSourceUnique<Exclude<TColumns, undefined>>>,
  TRelations extends {
    [identifier: string]: TColumns extends PgTypeColumns
      ? PgSourceRelation<TColumns, any>
      : never;
  },
> extends ExecutableStep<PgSourceRow<TColumns>> {
  static $$export = {
    moduleName: "@dataplan/pg",
    exportName: "PgUpdateStep",
  };
  isSyncAndSafe = false;

  hasSideEffects = true;

  /**
   * Tells us what we're dealing with - data type, columns, where to update it,
   * what it's called, etc.
   */
  public readonly source: PgSource<TColumns, TUniques, TRelations>;

  /**
   * This defaults to the name of the source but you can override it. Aids
   * in debugging.
   */
  private readonly name: string;

  /**
   * To be used as the table alias, we always use a symbol unless the calling
   * code specifically indicates a string to use.
   */
  private readonly symbol: symbol | string;

  /** = sql.identifier(this.symbol) */
  public readonly alias: SQL;

  /**
   * The columns and their dependency ids for us to find the record by.
   */
  private getBys: Array<{
    name: keyof TColumns;
    depId: number;
    pgCodec: PgTypeCodec<any, any, any>;
  }> = [];

  /**
   * The columns and their dependency ids for us to update.
   */
  private columns: Array<{
    name: keyof TColumns;
    depId: number;
    pgCodec: PgTypeCodec<any, any, any>;
  }> = [];

  /**
   * The id for the PostgreSQL context plan.
   */
  private contextId: number;

  /**
   * When locked, no more values can be set, no more selects can be added
   */
  private locked = false;

  /**
   * When finalized, we build the SQL query, queryValues, and note where to feed in
   * the relevant queryValues. This saves repeating this work at execution time.
   */
  private finalizeResults: PgUpdatePlanFinalizeResults | null = null;

  /**
   * The list of things we're selecting.
   */
  private selects: Array<SQL> = [];

  constructor(
    source: PgSource<TColumns, TUniques, TRelations>,
    getBy: PlanByUniques<TColumns, TUniques>,
    columns?: {
      [key in keyof TColumns]?: ExecutableStep<any>; // | PgTypedExecutableStep<TColumns[key]["codec"]>
    },
  ) {
    super();
    this.source = source;
    this.name = source.name;
    this.symbol = Symbol(this.name);
    this.alias = sql.identifier(this.symbol);
    this.contextId = this.addDependency(this.source.context());

    const keys: ReadonlyArray<keyof TColumns> = getBy
      ? (Object.keys(getBy) as Array<keyof TColumns>)
      : [];

    if (
      !this.source.uniques.some((uniq) =>
        uniq.columns.every((key) => keys.includes(key as any)),
      )
    ) {
      throw new Error(
        `Attempted to build 'PgUpdateStep' with a non-unique getBy keys ('${keys.join(
          "', '",
        )}') - please ensure your 'getBy' spec uniquely identifiers a row (source = ${
          this.source
        }; supported uniques = ${inspect(this.source.uniques)}).`,
      );
    }

    keys.forEach((name) => {
      if (isDev) {
        if (this.getBys.some((col) => col.name === name)) {
          throw new Error(
            `Column '${String(
              name,
            )}' was specified more than once in ${this}'s getBy spec`,
          );
        }
      }
      const value = getBy![name as any];
      const depId = this.addDependency(value);
      const column = this.source.codec.columns![name] as PgTypeColumn;
      const pgCodec = column.codec;
      this.getBys.push({ name, depId, pgCodec });
    });

    if (columns) {
      Object.entries(columns).forEach(([key, value]) => {
        if (value) {
          this.set(key as keyof TColumns, value as ExecutableStep<any>);
        }
      });
    }
  }

  set<TKey extends keyof TColumns>(
    name: TKey,
    value: ExecutableStep<any>, // | PgTypedExecutableStep<TColumns[TKey]["codec"]>
  ): void {
    if (this.locked) {
      throw new Error("Cannot set after plan is locked.");
    }
    if (isDev) {
      if (this.columns.some((col) => col.name === name)) {
        throw new Error(
          `Column '${String(name)}' was specified more than once in ${this}`,
        );
      }
    }
    const { codec: pgCodec } = this.source.codec.columns![name] as PgTypeColumn;
    const depId = this.addDependency(value);
    this.columns.push({ name, depId, pgCodec });
  }

  setPlan(): SetterStep<
    { [key in keyof TColumns & string]: ExecutableStep },
    this
  > {
    if (this.locked) {
      throw new Error(
        `${this}: cannot set values once plan is locked ('setPlan')`,
      );
    }
    return setter(this);
  }

  /**
   * Returns a plan representing a named attribute (e.g. column) from the newly
   * updateed row.
   */
  get<TAttr extends keyof TColumns>(
    attr: TAttr,
  ): PgClassExpressionStep<
    TColumns extends PgTypeColumns ? TColumns[TAttr]["codec"]["columns"] : any,
    TColumns extends PgTypeColumns ? TColumns[TAttr]["codec"] : any,
    TColumns,
    TUniques,
    TRelations
  > {
    const dataSourceColumn: PgTypeColumn =
      this.source.codec.columns![attr as string];
    if (!dataSourceColumn) {
      throw new Error(
        `${this.source} does not define an attribute named '${String(attr)}'`,
      );
    }

    if (dataSourceColumn?.via) {
      throw new Error(`Cannot select a 'via' column from PgUpdateStep`);
    }

    /*
     * Only cast to `::text` during select; we want to use it uncasted in
     * conditions/etc. The reasons we cast to ::text include:
     *
     * - to make return values consistent whether they're direct or in nested
     *   arrays
     * - to make sure that that various PostgreSQL clients we support do not
     *   mangle the data in unexpected ways - we take responsibility for
     *   decoding these string values.
     */

    const sqlExpr = pgClassExpression(this, dataSourceColumn.codec);
    const colPlan = dataSourceColumn.expression
      ? sqlExpr`${sql.parens(dataSourceColumn.expression(this.alias))}`
      : sqlExpr`${this.alias}.${sql.identifier(String(attr))}`;
    return colPlan as any;
  }

  public record(): PgClassExpressionStep<
    TColumns,
    PgTypeCodec<TColumns, any, any>,
    TColumns,
    TUniques,
    TRelations
  > {
    return pgClassExpression<
      TColumns,
      PgTypeCodec<TColumns, any, any>,
      TColumns,
      TUniques,
      TRelations,
      undefined
    >(this, this.source.codec)`${this.alias}`;
  }

  /**
   * Advanced method; rather than returning a plan it returns an index.
   * Generally useful for PgClassExpressionStep.
   *
   * @internal
   */
  public selectAndReturnIndex(fragment: SQL): number {
    // NOTE: it's okay to add selections after the plan is "locked" - lock only
    // applies to which rows are being selected, not what is being queried
    // about the rows.

    // Optimisation: if we're already selecting this fragment, return the existing one.
    const index = this.selects.findIndex((frag) =>
      sql.isEquivalent(frag, fragment),
    );
    if (index >= 0) {
      return index;
    }

    return this.selects.push(fragment) - 1;
  }

  /**
   * `execute` will always run as a root-level query. In future we'll implement a
   * `toSQL` method that allows embedding this plan within another SQL plan...
   * But that's a problem for later.
   *
   * This runs the query for every entry in the values, and then returns an
   * array of results where each entry in the results relates to the entry in
   * the incoming values.
   *
   * NOTE: we don't know what the values being fed in are, we must feed them to
   * the plans stored in this.identifiers to get actual values we can use.
   */
  async execute(
    values: Array<GrafastValuesList<any>>,
  ): Promise<GrafastResultsList<any>> {
    if (!this.finalizeResults) {
      throw new Error("Cannot execute PgSelectStep before finalizing it.");
    }
    const { text, rawSqlValues, queryValueDetailsBySymbol } =
      this.finalizeResults;

    // We must execute each mutation on its own, but we can at least do so in
    // parallel. Note we return a list of promises, each may reject or resolve
    // without causing the others to reject.
    return values[this.contextId].map(async (context, i) => {
      const sqlValues = queryValueDetailsBySymbol.size
        ? rawSqlValues.map((v) => {
            if (typeof v === "symbol") {
              const details = queryValueDetailsBySymbol.get(v);
              if (!details) {
                throw new Error(`Saw unexpected symbol '${inspect(v)}'`);
              }
              return details.processor(values[details.depId][i]);
            } else {
              return v;
            }
          })
        : rawSqlValues;
      const { rows, rowCount } = await this.source.executeMutation({
        context,
        text,
        values: sqlValues,
      });
      return rows[0] ?? (rowCount === 0 ? null : {});
    });
  }

  public finalize(): void {
    if (!this.isFinalized) {
      this.locked = true;
      const sourceSource = this.source.source;
      if (!sql.isSQL(sourceSource)) {
        throw new Error(
          `Error in ${this}: can only update into sources defined as SQL, however ${
            this.source
          } has ${inspect(this.source.source)}`,
        );
      }
      const table = sql`${sourceSource} as ${this.alias}`;

      const fragmentsWithAliases = this.selects.map(
        (frag, idx) => sql`${frag} as ${sql.identifier(String(idx))}`,
      );
      const returning =
        fragmentsWithAliases.length > 0
          ? sql` returning\n${sql.indent(
              sql.join(fragmentsWithAliases, ",\n"),
            )}`
          : sql.blank;

      /*
       * NOTE: Though we'd like to do bulk updates, there's no way of us
       * reliably linking the data back up again given users might have
       * triggers manipulating the data so we can't match it back up even using
       * the same getBy specs.
       *
       * Currently it seems that the order returned from `update ...
       * from (select ... order by ...) returning ...` is the same order as the
       * `order by` was, however this is not guaranteed in the documentation
       * and as such cannot be relied upon. Further the pgsql-hackers list
       * explicitly declined guaranteeing this behavior:
       *
       * https://www.postgresql.org/message-id/CAKFQuwbgdJ_xNn0YHWGR0D%2Bv%2B3mHGVqJpG_Ejt96KHoJjs6DkA%40mail.gmail.com
       *
       * So we have to make do with single updates, alas.
       */
      const getByColumnsCount = this.getBys.length;
      const columnsCount = this.columns.length;
      if (columnsCount === 0) {
        // No columns to update?! This isn't allowed.
        throw new Error(
          "Attempted to update a record, but no new values were specified.",
        );
      } else if (getByColumnsCount === 0) {
        // No columns specified to find the row?! This is forbidden.
        throw new Error(
          "Attempted to update a record, but no information on uniquely determining the record was specified.",
        );
      } else {
        // This is our common path
        const sqlWhereClauses: SQL[] = [];
        const sqlSets: SQL[] = [];
        const queryValueDetailsBySymbol: QueryValueDetailsBySymbol = new Map();

        for (let i = 0; i < getByColumnsCount; i++) {
          const { name, depId, pgCodec } = this.getBys[i];
          const symbol = Symbol(name as string);
          sqlWhereClauses[i] = sql.parens(
            sql`${sql.identifier(this.symbol, name as string)} = ${sql.value(
              // THIS IS A DELIBERATE HACK - we will be replacing this symbol with
              // a value before executing the query.
              symbol as any,
            )}::${pgCodec.sqlType}`,
          );
          queryValueDetailsBySymbol.set(symbol, {
            depId,
            processor: pgCodec.toPg,
          });
        }

        for (let i = 0; i < columnsCount; i++) {
          const { name, depId, pgCodec } = this.columns[i];
          const symbol = Symbol(name as string);
          sqlSets[i] = sql`${sql.identifier(name as string)} = ${sql.value(
            // THIS IS A DELIBERATE HACK - we will be replacing this symbol with
            // a value before executing the query.
            symbol as any,
          )}::${pgCodec.sqlType}`;
          queryValueDetailsBySymbol.set(symbol, {
            depId,
            processor: pgCodec.toPg,
          });
        }

        const set = sql` set ${sql.join(sqlSets, ", ")}`;
        const where = sql` where ${sql.parens(
          sql.join(sqlWhereClauses, " and "),
        )}`;
        const query = sql`update ${table}${set}${where}${returning};`;
        const { text, values: rawSqlValues } = sql.compile(query);

        this.finalizeResults = {
          text,
          rawSqlValues,
          queryValueDetailsBySymbol,
        };
      }
    }

    super.finalize();
  }
}

/**
 * Update a single row identified by the 'getBy' argument.
 */
export function pgUpdate<
  TColumns extends PgTypeColumns | undefined,
  TUniques extends ReadonlyArray<PgSourceUnique<Exclude<TColumns, undefined>>>,
  TRelations extends {
    [identifier: string]: TColumns extends PgTypeColumns
      ? PgSourceRelation<TColumns, any>
      : never;
  },
>(
  source: PgSource<TColumns, TUniques, TRelations>,
  getBy: PlanByUniques<TColumns, TUniques>,
  columns?: {
    [key in keyof TColumns]?: ExecutableStep<any>; // | PgTypedExecutableStep<TColumns[key]["codec"]>
  },
): PgUpdateStep<TColumns, TUniques, TRelations> {
  return new PgUpdateStep(source, getBy, columns);
}

Object.defineProperty(pgUpdate, "$$export", {
  value: {
    moduleName: "@dataplan/pg",
    exportName: "pgUpdate",
  },
});