export type GraphQLOperationKind = "query" | "mutation" | "subscription";

export type GraphQLExplorerArg = {
  name: string;
  description?: string;
  type: string;
  typeName: string;
  required: boolean;
  isLeaf: boolean;
  defaultValue?: string;
  options?: string[];
};

export type GraphQLExplorerField = {
  name: string;
  description?: string;
  type: string;
  typeName: string;
  isLeaf: boolean;
  args: GraphQLExplorerArg[];
};

export type GraphQLExplorerType = {
  kind: string;
  description?: string;
  fields?: GraphQLExplorerField[];
  inputFields?: GraphQLExplorerArg[];
  enumValues?: Array<{ name: string; description?: string }>;
  possibleTypes?: string[];
};

export type GraphQLExplorerSchema = {
  queryType: string;
  mutationType?: string;
  subscriptionType?: string;
  types: Record<string, GraphQLExplorerType>;
};

export type GraphQLBodyRange = {
  startLine: number;
  endLine: number;
  insert: boolean;
  leadingBlank?: boolean;
};

export type GraphQLExplorerEdit =
  | { kind: "toggleField"; path: string[] }
  | { kind: "toggleArg"; path: string[]; name: string }
  | { kind: "setArg"; path: string[]; name: string; value: string }
  | { kind: "setOperation"; operation: GraphQLOperationKind };

export type GraphQLViewState = {
  theme: "light" | "dark";
  endpoint?: string;
  cacheKey?: string;
  operation: GraphQLOperationKind;
  patchable: boolean;
  reason?: string;
  schema: GraphQLExplorerSchema;
  checkedFields: string[];
  checkedArgs: string[];
  argValues: Record<string, string>;
};

export type GraphQLWebviewMessage =
  | { type: "toggleField"; path: string[]; operation: GraphQLOperationKind }
  | { type: "toggleArg"; path: string[]; name: string; operation: GraphQLOperationKind }
  | { type: "setArg"; path: string[]; name: string; value: string }
  | { type: "run" }
  | { type: "copy" }
  | { type: "refresh" }
  | { type: "close" };

export type GraphQLExtensionMessage = {
  type: "graphqlState";
  payload: GraphQLViewState;
};
