<script lang="ts">
  import { onMount } from "svelte";
  import type { GraphQLViewState, GraphQLWebviewMessage } from "../../../../shared/graphql-view";
  import { buildGraphQLTree, type GraphQLTreeNode } from "$lib/graphqlTree";
  import { getVsCodeApi, listenForGraphqlMessages, readInitialGraphqlPayload } from "$lib/vscode";

  let state = $state<GraphQLViewState | undefined>(undefined);
  /** Field ids that are folded. A record, because replacing a Set does not refresh this view. */
  let collapsed = $state<Record<string, boolean>>({});
  let seeded = $state(false);
  let filter = $state("");
  let pending = $state<Record<string, string>>({});

  const tree = $derived(state ? buildGraphQLTree(state, filter) : []);

  function hasChecked(node: GraphQLTreeNode): boolean {
    return node.checked === true || node.children.some(hasChecked);
  }

  function applyState(next: GraphQLViewState) {
    state = next;
    const built = buildGraphQLTree(next, "");
    if (!seeded) {
      collapsed = collectCollapsibleIds(built);
      seeded = true;
      return;
    }
    revealChecked(built);
  }

  function revealChecked(nodes: GraphQLTreeNode[]): void {
    for (const node of nodes) {
      if (node.children.length && hasChecked(node)) collapsed[node.id] = false;
      if (node.children.length) revealChecked(node.children);
    }
  }

  function collectCollapsibleIds(
    nodes: GraphQLTreeNode[],
    into: Record<string, boolean> = {},
  ): Record<string, boolean> {
    for (const node of nodes) {
      if (node.kind !== "root" && node.children.length && !hasChecked(node)) into[node.id] = true;
      if (node.children.length) collectCollapsibleIds(node.children, into);
    }
    return into;
  }

  function toggleFold(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function post(message: GraphQLWebviewMessage) {
    getVsCodeApi()?.postMessage(message);
  }

  function literalArg(node: GraphQLTreeNode): boolean {
    return node.kind === "arg" && !node.options?.length && node.typeName !== "Boolean";
  }

  function clearPending(id: string) {
    if (!(id in pending)) return;
    const next = { ...pending };
    delete next[id];
    pending = next;
  }

  function toggleNode(node: GraphQLTreeNode) {
    if (!state?.patchable || node.kind === "root") return;
    if (node.kind === "arg" && node.argName) {
      if (!node.checked && literalArg(node)) {
        pending = { ...pending, [node.id]: pending[node.id] ?? "" };
        return;
      }
      clearPending(node.id);
      post({ type: "toggleArg", path: node.path, name: node.argName, operation: node.operation });
      return;
    }
    if (!node.checked) collapsed[node.id] = false;
    post({ type: "toggleField", path: node.path, operation: node.operation });
  }

  function setArg(node: GraphQLTreeNode, value: string) {
    if (!node.argName || value.trim() === "") return;
    post({ type: "setArg", path: node.path, name: node.argName, value });
    clearPending(node.id);
  }

  onMount(() => {
    const initial = readInitialGraphqlPayload();
    if (initial) applyState(initial);
    return listenForGraphqlMessages(applyState);
  });
</script>

{#snippet nodes(items: GraphQLTreeNode[], depth: number)}
  {#each items as node (node.id)}
    {@const hasChildren = node.children.length > 0}
    {@const folded = filter.trim() === "" && collapsed[node.id] === true}
    <div class="gql-node" style:--depth={depth}>
      <div class="gql-row">
        {#if hasChildren}
          <button type="button" class="gql-fold" onclick={() => toggleFold(node.id)}>
            {folded ? "▶" : "▼"}
          </button>
        {:else}
          <span class="gql-fold"></span>
        {/if}
        {#if node.kind !== "root"}
          <input
            type="checkbox"
            checked={node.checked === true || node.id in pending}
            disabled={state?.patchable === false}
            onclick={(event) => {
              event.preventDefault();
              toggleNode(node);
            }}
          />
        {/if}
        <button
          type="button"
          class="gql-name gql-{node.kind}"
          class:gql-expandable={hasChildren}
          onclick={() => {
            if (hasChildren) toggleFold(node.id);
          }}
        >{node.name}</button>
        {#if node.type}
          <span class="gql-type">{node.type}</span>
        {/if}
        {#if node.kind === "arg"}
          <span class="gql-arg">ARG</span>
        {/if}
        {#if node.required}
          <span class="gql-arg">required</span>
        {/if}
      </div>
      {#if node.description && !folded}
        <div class="gql-desc">{node.description}</div>
      {/if}
      {#if node.kind === "arg" && (node.checked || node.id in pending) && !folded}
        <div class="gql-edit">
          {#if node.options?.length}
            <select
              class="gql-input"
              value={node.value ?? ""}
              onchange={(event) => setArg(node, (event.currentTarget as HTMLSelectElement).value)}
            >
              {#each node.options as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else if node.typeName === "Boolean"}
            <select
              class="gql-input"
              value={node.value ?? "true"}
              onchange={(event) => setArg(node, (event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          {:else}
            <input
              class="gql-input"
              value={node.value ?? pending[node.id] ?? ""}
              onchange={(event) => setArg(node, (event.currentTarget as HTMLInputElement).value)}
            />
          {/if}
        </div>
      {/if}
      {#if hasChildren && !folded}
        {@render nodes(node.children, depth + 1)}
      {/if}
    </div>
  {/each}
{/snippet}

<div class="gql-page" data-theme={state?.theme ?? "dark"}>
  <div class="gql-header">
    <div>
      <div class="gql-heading">GraphQL</div>
      {#if state?.endpoint}
        <div class="gql-sub">{state.endpoint}</div>
      {/if}
    </div>
    <div class="gql-actions">
      <button type="button" class="kulala-btn kulala-btn-sm kulala-btn-ghost" onclick={() => post({ type: "copy" })}>
        Copy
      </button>
      <button type="button" class="kulala-btn kulala-btn-sm kulala-btn-ghost" onclick={() => post({ type: "refresh" })}>
        Refresh
      </button>
      <button type="button" class="kulala-btn kulala-btn-sm kulala-btn-primary" onclick={() => post({ type: "run" })}>
        Run
      </button>
    </div>
  </div>
  <div class="gql-search">
    <input
      class="gql-input"
      placeholder="Search fields"
      bind:value={filter}
    />
  </div>
  {#if state?.patchable === false && state.reason}
    <div class="gql-reason">{state.reason}</div>
  {/if}
  <div class="gql-tree">
    {#if tree.length === 0}
      <p class="gql-empty">No GraphQL fields</p>
    {:else}
      {@render nodes(tree, 0)}
    {/if}
  </div>
</div>

<style>
  .gql-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .gql-header,
  .gql-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .gql-header {
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .gql-heading {
    font-weight: 600;
  }

  .gql-sub,
  .gql-desc,
  .gql-empty,
  .gql-reason {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .gql-search,
  .gql-reason {
    padding: 0.5rem 1rem 0;
  }

  .gql-tree {
    flex: 1;
    overflow: auto;
    padding: 0.5rem 0.75rem 1.5rem;
  }

  .gql-node {
    margin-left: calc(var(--depth) * 0.85rem);
  }

  .gql-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.6rem;
  }

  .gql-fold {
    width: 1.25rem;
    flex: 0 0 1.25rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 0.7rem;
  }

  .gql-name {
    border: none;
    background: transparent;
    color: inherit;
    padding: 0;
    text-align: left;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85rem;
  }

  .gql-name.gql-root {
    font-weight: 600;
  }

  .gql-expandable {
    cursor: pointer;
  }

  .gql-type,
  .gql-arg {
    font-size: 0.65rem;
    opacity: 0.75;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .gql-desc,
  .gql-edit {
    margin: 0 0 0.35rem 1.5rem;
  }

  .gql-input {
    width: min(100%, 24rem);
    font-family: var(--vscode-editor-font-family, monospace);
  }
</style>
