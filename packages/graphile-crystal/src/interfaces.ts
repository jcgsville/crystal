import type {
  FieldNode,
  GraphQLArgumentConfig,
  GraphQLFieldConfig,
  GraphQLInputFieldConfig,
  GraphQLInputType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLType,
  SelectionNode,
} from "graphql";

import type { Aether, CrystalError } from "./aether";
import type { Deferred } from "./deferred";
import type { InputPlan } from "./input";
import type { ExecutablePlan, ListCapablePlan, ModifierPlan } from "./plan";
import type { PlanResults, PlanResultsBucket } from "./planResults";
import type { __TrackedObjectPlan } from "./plans";
import type {
  GraphileInputObjectType,
  GraphileObjectType,
  UniqueId,
} from "./utils";

declare module "graphql" {
  interface GraphQLFieldExtensions<_TSource, _TContext, _TArgs = any> {
    graphile?: {
      plan?: ExecutablePlanResolver<any, any, any, any>;
      subscribePlan?: ExecutablePlanResolver<any, any, any, any>;
    };
  }

  interface GraphQLArgumentExtensions {
    graphile?: {
      plan?: ArgumentPlanResolver<any, any, any, any, any>;
    };
  }

  interface GraphQLInputFieldExtensions {
    graphile?: {
      plan?: InputObjectFieldPlanResolver<any, any, any, any>;
    };
  }

  interface GraphQLObjectTypeExtensions<_TSource = any, _TContext = any> {
    graphile?: {
      Plan?: { new (...args: any[]): ExecutablePlan };
    };
  }

  interface GraphQLEnumValueExtensions {
    graphile?: {
      /**
       * EXPERIMENTAL!
       *
       * NOTE: this is an `any` because we want to allow users to specify
       * subclasses of ExecutablePlan but TypeScript only wants to allow
       * superclasses.
       *
       * @internal
       */
      plan?: (plan: any) => void;
    };
  }
}

export const $$crystalContext = Symbol("context");
export const $$planResults = Symbol("planResults");
export const $$id = Symbol("id");
export const $$pathIdentity = Symbol("pathIdentity");

export const $$concreteType = Symbol("concreteType");
export const $$concreteData = Symbol("concreteData");

export interface PolymorphicData<TType extends string = string, TData = any> {
  [$$concreteType]: TType;
  [$$concreteData]: TData;
}

export interface IndexByListItemPlanId {
  [listItemPlanId: number]: number;
}

// TODO: remove <TData>
export interface CrystalObject {
  toString(): string;
  [$$id]: UniqueId;
  [$$pathIdentity]: string;
  [$$concreteType]: string;
  [$$crystalContext]: CrystalContext;

  /**
   * This is the plan result cache accessible from this CrystalObject - it
   * should contain all the previously executed plans that plans below this
   * CrystalObject in the operation depend on. See `PlanResults` for more
   * information on the specifics of how the plan results are stored/accessed.
   *
   * When evaluating a particular CrystalObject you can be certain that all the
   * list indexes have already been factored into the cache, so you just need
   * to supply a plan's `commonAncestorPathIdentity` and `id` to read/write the
   * data.
   *
   * When a new level of CrystalObject is created it will inherit a _copy_ of
   * $$planResults from its parent - that way any shared `pathIdentity`
   * "buckets" will share changes between them (since the values are references
   * to the same objects), but any new pathIdentities will diverge - again, see
   * `PlanResults` for more information on this.
   *
   * Plans can be executed more than once due to parts of the tree being
   * delayed (possibly due to `@stream`/`@defer`, possibly just due to the
   * resolvers for one "layer" not all completing at the same time), so we
   * cannot rely on writing the results all at once.
   */
  [$$planResults]: PlanResults;
}

export const $$isCrystalLayerObject = Symbol("crystalLayerObject");

/**
 * A "CrystalLayerObject" represents an intermediate stage whilst resolving a
 * field against a CrystalObject parent - it acts as a container for the
 * intermediate `planResults` (which is important!) and `indexes` (which is
 * only really used for debugging).
 *
 * Note that a field might actually have a stack of plans that need to be
 * executed, and may result in lists (or even lists of lists) being returned;
 * to handle this new CrystalLayerObjects are created at each list-like layer
 * in this stack before ultimately having CrystalObjects generated from the
 * result. I.e. CrystalLayerObjects are very short-lived - only existing during
 * `executePlan`.
 */
export interface CrystalLayerObject {
  toString(): string;
  [$$isCrystalLayerObject]: true;
  parentCrystalObject: CrystalObject;
  itemByItemPlanId: Map<number, any>;
  planResults: PlanResults;
  indexes: number[];
}

export interface Batch {
  pathIdentity: string;
  crystalContext: CrystalContext;
  sideEffectPlans: ReadonlyArray<ExecutablePlan>;
  plan: ExecutablePlan;
  itemPlan: ExecutablePlan;
  entries: Array<[CrystalObject, Deferred<any>]>;
  namedReturnType: GraphQLNamedType & GraphQLOutputType;
  /**
   * If the user has their own resolver we must return raw data, otherwise
   * we'll return CrystalObjects.
   */
  returnRaw: boolean;
}

export interface CrystalContext {
  aether: Aether;

  metaByPlanId: {
    [planId: number]: Record<string, unknown> | undefined;
  };

  inProgressPlanResolutions: {
    [planId: number]: Map<PlanResultsBucket, Deferred<any>>;
  };

  rootId: UniqueId;

  rootCrystalObject: CrystalObject;
}

// These values are just to make reading the code a little clearer
export type CrystalValuesList<T> = ReadonlyArray<T>;
export type PromiseOrDirect<T> = Promise<T> | T;
export type CrystalResultsList<T> = ReadonlyArray<PromiseOrDirect<T>>;
export type CrystalResultStreamList<T> = ReadonlyArray<
  AsyncIterable<PromiseOrDirect<T>> | CrystalError
>;

export type BaseGraphQLRootValue = any;
export interface BaseGraphQLContext {}
export interface BaseGraphQLVariables {
  [key: string]: unknown;
}
export interface BaseGraphQLArguments {
  [key: string]: any;
}
export type BaseGraphQLInputObject = BaseGraphQLArguments;

// TODO: rename ExecutablePlanResolver to FieldPlanResolver?
/**
 * Plan resolvers are like regular resolvers except they're called beforehand,
 * they return plans rather than values, and they only run once for lists
 * rather than for each item in the list.
 *
 * The idea is that the plan resolver returns a plan object which later will
 * process the data and feed that into the actual resolver functions
 * (preferably using the default resolver function?).
 *
 * They are stored onto `<field>.extensions.graphile.plan`
 *
 * @returns a plan for this field.
 *
 * @remarks
 * We're using `TrackedObject<...>` so we can later consider caching these
 * executions.
 */
export type ExecutablePlanResolver<
  TContext extends BaseGraphQLContext,
  TArgs extends BaseGraphQLArguments,
  TParentPlan extends ExecutablePlan<any> | null,
  TResultPlan extends ExecutablePlan<any>,
> = (
  $parentPlan: TParentPlan,
  args: TrackedArguments<TArgs>,
  context: __TrackedObjectPlan<TContext>,
) => TResultPlan;

export type InputObjectFieldPlanResolver<
  TContext extends BaseGraphQLContext,
  TInput extends InputPlan,
  TParentPlan extends ModifierPlan<any> | null,
  TResultPlan extends ModifierPlan<
    ExecutablePlan<any> | ModifierPlan<any>
  > | null,
> = (
  $parentPlan: TParentPlan,
  $input: TInput,
  context: __TrackedObjectPlan<TContext>,
) => TResultPlan;

export type ArgumentPlanResolver<
  TContext extends BaseGraphQLContext,
  TInput extends InputPlan,
  TParentPlan extends ExecutablePlan<any> | null,
  TFieldPlan extends ExecutablePlan<any> | null,
  TResultPlan extends ModifierPlan<
    ExecutablePlan<any> | ModifierPlan<any>
  > | null,
> = (
  $parentPlan: TParentPlan,
  $fieldPlan: TFieldPlan,
  $input: TInput,
  context: __TrackedObjectPlan<TContext>,
) => TResultPlan;

// TypeScript gets upset if we go too deep, so we try and cover the most common
// use cases and fall back to `any`
type OutputPlanForNamedType<TType extends GraphQLType> =
  TType extends GraphileObjectType<any, infer TPlan, any>
    ? TPlan
    : ExecutablePlan<any>;

// TODO: this is completely wrong now; ListCapablePlan is no longer required to be supported for lists.
export type OutputPlanForType<TType extends GraphQLOutputType> =
  TType extends GraphQLNonNull<GraphQLList<GraphQLNonNull<infer U>>>
    ? ListCapablePlan<any, OutputPlanForNamedType<U>>
    : TType extends GraphQLNonNull<GraphQLList<infer U>>
    ? ListCapablePlan<any, OutputPlanForNamedType<U>>
    : TType extends GraphQLList<GraphQLNonNull<infer U>>
    ? ListCapablePlan<any, OutputPlanForNamedType<U>>
    : TType extends GraphQLList<infer U>
    ? ListCapablePlan<any, OutputPlanForNamedType<U>>
    : TType extends GraphQLNonNull<infer U>
    ? OutputPlanForNamedType<U>
    : OutputPlanForNamedType<TType>;

// TypeScript gets upset if we go too deep, so we try and cover the most common
// use cases and fall back to `any`
type InputPlanForNamedType<TType extends GraphQLType> =
  TType extends GraphileInputObjectType<any, infer U, any>
    ? U
    : ModifierPlan<any>;
type InputPlanForType<TType extends GraphQLInputType> =
  TType extends GraphQLNonNull<GraphQLList<GraphQLNonNull<infer U>>>
    ? InputPlanForNamedType<U>
    : TType extends GraphQLNonNull<GraphQLList<infer U>>
    ? InputPlanForNamedType<U>
    : TType extends GraphQLList<GraphQLNonNull<infer U>>
    ? InputPlanForNamedType<U>
    : TType extends GraphQLList<infer U>
    ? InputPlanForNamedType<U>
    : TType extends GraphQLNonNull<infer U>
    ? InputPlanForNamedType<U>
    : InputPlanForNamedType<TType>;

// TypeScript gets upset if we go too deep, so we try and cover the most common
// use cases and fall back to `any`
type InputTypeForNamedType<TType extends GraphQLType> =
  TType extends GraphQLScalarType<infer U> ? U : any;
type InputTypeFor<TType extends GraphQLInputType> =
  TType extends GraphQLNonNull<GraphQLList<GraphQLNonNull<infer U>>>
    ? InputTypeForNamedType<U>
    : TType extends GraphQLNonNull<GraphQLList<infer U>>
    ? InputTypeForNamedType<U>
    : TType extends GraphQLList<GraphQLNonNull<infer U>>
    ? InputTypeForNamedType<U>
    : TType extends GraphQLList<infer U>
    ? InputTypeForNamedType<U>
    : TType extends GraphQLNonNull<infer U>
    ? InputTypeForNamedType<U>
    : InputTypeForNamedType<TType>;

/*
type OutputPlanForType<TType extends GraphQLOutputType> =
  TType extends GraphQLList<
  infer U
>
  ? U extends GraphQLOutputType
    ? ListCapablePlan<any, OutputPlanForType<U>>
    : never
  : TType extends GraphQLNonNull<infer V>
  ? V extends GraphQLOutputType
    ? OutputPlanForType<V>
    : never
  : TType extends GraphQLScalarType | GraphQLEnumType
  ? ExecutablePlan<boolean | number | string>
  : ExecutablePlan<{ [key: string]: any }>;

type InputPlanForType<TType extends GraphQLInputType> =
  TType extends GraphQLList<infer U>
    ? U extends GraphQLInputType
      ? InputPlanForType<U>
      : never
    : TType extends GraphQLNonNull<infer V>
    ? V extends GraphQLInputType
      ? InputPlanForType<V>
      : never
    : TType extends GraphQLScalarType | GraphQLEnumType
    ? null
    : ExecutablePlan<{ [key: string]: any }> | null;

type InputTypeFor<TType extends GraphQLInputType> = TType extends GraphQLList<
  infer U
>
  ? U extends GraphQLInputType
    ? InputTypeFor<U>
    : never
  : TType extends GraphQLNonNull<infer V>
  ? V extends GraphQLInputType
    ? InputTypeFor<V>
    : never
  : TType extends GraphQLScalarType<infer U>
  ? U
  : any;
  */

/**
 * Basically GraphQLFieldConfig but with an easy to access `plan` method.
 */
export type GraphileFieldConfig<
  TType extends GraphQLOutputType,
  TContext extends BaseGraphQLContext,
  TParentPlan extends ExecutablePlan<any> | null,
  TFieldPlan extends ExecutablePlan<any>, // TODO: should be OutputPlanForType<TType>, but that results in everything thinking it should be a ListPlan
  TArgs extends BaseGraphQLArguments,
> = Omit<GraphQLFieldConfig<any, any>, "args" | "type"> & {
  type: TType;
  plan?: ExecutablePlanResolver<TContext, TArgs, TParentPlan, TFieldPlan>;
  subscribePlan?: ExecutablePlanResolver<
    TContext,
    TArgs,
    TParentPlan,
    TFieldPlan
  >;
  args?: GraphileFieldConfigArgumentMap<
    TType,
    TContext,
    TParentPlan,
    TFieldPlan
  >;
};

export type GraphileFieldConfigArgumentMap<
  _TType extends GraphQLOutputType,
  TContext extends BaseGraphQLContext,
  TParentPlan extends ExecutablePlan<any> | null,
  TFieldPlan extends ExecutablePlan<any>, // TODO: should be OutputPlanForType<_TType>, but that results in everything thinking it should be a ListPlan
> = {
  [argName: string]: GraphileArgumentConfig<
    any,
    TContext,
    TParentPlan,
    TFieldPlan,
    any,
    any
  >;
};

export type GraphileArgumentConfig<
  TInputType extends GraphQLInputType,
  TContext extends BaseGraphQLContext,
  TParentPlan extends ExecutablePlan<any> | null,
  TFieldPlan extends ExecutablePlan<any>,
  TArgumentPlan extends TFieldPlan extends ExecutablePlan<any>
    ? ModifierPlan<TFieldPlan> | null
    : null,
  TInput extends InputTypeFor<TInputType>,
> = Omit<GraphQLArgumentConfig, "type"> & {
  type: TInputType;
  plan?: TParentPlan extends ExecutablePlan<any>
    ? ArgumentPlanResolver<
        TContext,
        TInput,
        TParentPlan,
        TFieldPlan,
        TArgumentPlan
      >
    : never;
};

export type GraphileInputFieldConfig<
  TInputType extends GraphQLInputType,
  TContext extends BaseGraphQLContext,
  TParentPlan extends ModifierPlan<any>,
  TResultPlan extends InputPlanForType<TInputType>,
  TInput extends InputTypeFor<TInputType>,
> = Omit<GraphQLInputFieldConfig, "type"> & {
  type: TInputType;
  plan?: InputObjectFieldPlanResolver<
    TContext,
    TInput,
    TParentPlan,
    TResultPlan
  >;
};

export type TrackedArguments<
  TArgs extends BaseGraphQLArguments = BaseGraphQLArguments,
> = {
  [key in keyof TArgs]: InputPlan;
};

/**
 * Represents the selections that happen within a particular group within a
 * particular point in the GraphQL document.
 */
export interface GroupedSelections {
  groupId: number;
  selections: ReadonlyArray<SelectionNode>;
}

/**
 * Represents an individual field and it's group.
 */
export interface FieldAndGroup {
  groupId: number;
  field: FieldNode;
}

export interface PlanStreamOptions {
  initialCount: number;
}
export interface PlanOptions {
  stream: PlanStreamOptions | null;
}

export interface PlanOptimizeOptions {
  stream: PlanStreamOptions | null;
}

/**
 * A subscriber provides realtime data, a SubscribePlan can subscribe to a
 * given topic (string) and will receive an AsyncIterableIterator with messages
 * published to that topic (standard pub/sub semantics).
 */
export type CrystalSubscriber<
  TTopics extends { [key: string]: any } = { [key: string]: any },
> = {
  subscribe<TTopic extends keyof TTopics = keyof TTopics>(
    topic: TTopic,
  ): AsyncIterableIterator<TTopics[TTopic]>;
};