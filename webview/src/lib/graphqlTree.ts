import type {
  GraphQLExplorerSchema,
  GraphQLOperationKind,
  GraphQLViewState,
} from "../../../shared/graphql-view";

export type GraphQLTreeNode = {
  id: string;
  kind: "root" | "field" | "arg" | "fragment";
  name: string;
  path: string[];
  operation: GraphQLOperationKind;
  type?: string;
  typeName?: string;
  description?: string;
  checked?: boolean;
  required?: boolean;
  options?: string[];
  value?: string;
  argName?: string;
  children: GraphQLTreeNode[];
};

function stringSet(list: string[] | undefined): Set<string> {
  return new Set(list ?? []);
}

function withType(ancestors: Set<string>, typeName: string | undefined): Set<string> {
  const next = new Set(ancestors);
  if (typeName) next.add(typeName);
  return next;
}

function fieldsOf(
  schema: GraphQLExplorerSchema,
  typeName: string | undefined,
  path: string[],
  ancestors: Set<string>,
  operation: GraphQLOperationKind,
  checkedFields: Set<string>,
  checkedArgs: Set<string>,
  argValues: Record<string, string>,
): GraphQLTreeNode[] {
  if (!typeName || ancestors.has(typeName)) return [];
  const typeDef = schema.types[typeName];
  if (!typeDef?.fields?.length) return [];
  const childAncestors = withType(ancestors, typeName);
  const nodes: GraphQLTreeNode[] = [];
  for (const field of typeDef.fields) {
    if (field.name === "__typename") continue;
    const fieldPath = [...path, field.name];
    const key = fieldPath.join(".");
    const children: GraphQLTreeNode[] = [];
    for (const arg of field.args ?? []) {
      const argKey = `${key}.${arg.name}`;
      children.push({
        // Args and child fields share the path key (`person.id`), which breaks keyed lists.
        id: `arg:${argKey}`,
        kind: "arg",
        name: arg.name,
        path: fieldPath,
        operation,
        type: arg.type,
        typeName: arg.typeName,
        description: arg.description,
        checked: checkedArgs.has(argKey),
        required: arg.required,
        options: arg.options,
        value: argValues[argKey],
        argName: arg.name,
        children: [],
      });
    }
    if (!field.isLeaf && !childAncestors.has(field.typeName)) {
      children.push(
        ...fieldsOf(
          schema,
          field.typeName,
          fieldPath,
          childAncestors,
          operation,
          checkedFields,
          checkedArgs,
          argValues,
        ),
      );
      const possible = schema.types[field.typeName]?.possibleTypes ?? [];
      for (const possibleName of possible) {
        const fragmentPath = [...fieldPath, `on:${possibleName}`];
        const fragmentKey = fragmentPath.join(".");
        children.push({
          id: fragmentKey,
          kind: "fragment",
          name: `... on ${possibleName}`,
          path: fragmentPath,
          operation,
          typeName: possibleName,
          checked: checkedFields.has(fragmentKey),
          children: fieldsOf(
            schema,
            possibleName,
            fragmentPath,
            childAncestors,
            operation,
            checkedFields,
            checkedArgs,
            argValues,
          ),
        });
      }
    }
    nodes.push({
      id: key,
      kind: "field",
      name: field.name,
      path: fieldPath,
      operation,
      type: field.type,
      typeName: field.typeName,
      description: field.description,
      checked: checkedFields.has(key),
      children,
    });
  }
  return nodes;
}

function matches(filter: string, node: GraphQLTreeNode): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return [node.name, node.description, node.type].some((text) =>
    text?.toLowerCase().includes(needle),
  );
}

function filterNodes(nodes: GraphQLTreeNode[], filter: string): GraphQLTreeNode[] {
  if (!filter) return nodes;
  const out: GraphQLTreeNode[] = [];
  for (const node of nodes) {
    const children = filterNodes(node.children, filter);
    if (matches(filter, node) || children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

export function buildGraphQLTree(state: GraphQLViewState, filter: string): GraphQLTreeNode[] {
  const checkedFields = stringSet(state.checkedFields);
  const checkedArgs = stringSet(state.checkedArgs);
  const argValues = state.argValues ?? {};
  const roots: Array<{ operation: GraphQLOperationKind; typeName?: string; title: string }> = [
    { operation: "query", typeName: state.schema.queryType, title: "Query" },
    { operation: "mutation", typeName: state.schema.mutationType, title: "Mutation" },
    { operation: "subscription", typeName: state.schema.subscriptionType, title: "Subscription" },
  ];
  const nodes: GraphQLTreeNode[] = [];
  for (const root of roots) {
    if (!root.typeName) continue;
    nodes.push({
      id: `root:${root.operation}`,
      kind: "root",
      name: root.title,
      path: [],
      operation: root.operation,
      typeName: root.typeName,
      children: fieldsOf(
        state.schema,
        root.typeName,
        [],
        new Set(),
        root.operation,
        checkedFields,
        checkedArgs,
        argValues,
      ),
    });
  }
  return filterNodes(nodes, filter.trim());
}
