import type {
  ExtensionMessage,
  WebviewMessage,
  WebviewPayload,
} from "../../../shared/response-view";
import type {
  GraphQLExtensionMessage,
  GraphQLViewState,
  GraphQLWebviewMessage,
} from "../../../shared/graphql-view";
import type {
  OpenAPIExtensionMessage,
  OpenAPIViewState,
  OpenAPIWebviewMessage,
} from "../../../shared/openapi-view";

type VsCodeApi = {
  postMessage(message: WebviewMessage | OpenAPIWebviewMessage | GraphQLWebviewMessage): void;
  getState(): { tab?: WebviewPayload["tab"] } | undefined;
  setState(state: { tab: WebviewPayload["tab"] }): void;
};

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi | undefined {
  if (api) return api;
  if (typeof acquireVsCodeApi !== "function") return undefined;
  api = acquireVsCodeApi() as VsCodeApi;
  return api;
}

export function readInitialPayload(): WebviewPayload | undefined {
  const data = window.__KULALA__;
  if (!data?.entries) return undefined;
  return data;
}

export function readInitialOpenapiPayload(): OpenAPIViewState | undefined {
  return window.__KULALA_OPENAPI__;
}

export function readInitialGraphqlPayload(): GraphQLViewState | undefined {
  return window.__KULALA_GRAPHQL__;
}

export function listenForExtensionMessages(onState: (payload: WebviewPayload) => void): () => void {
  const handler = (event: MessageEvent<ExtensionMessage>) => {
    const message = event.data;
    if (message?.type === "state") {
      onState(message.payload);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

export function listenForGraphqlMessages(onState: (payload: GraphQLViewState) => void): () => void {
  const handler = (event: MessageEvent<GraphQLExtensionMessage>) => {
    const message = event.data;
    if (message?.type === "graphqlState") {
      onState(message.payload);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

export function listenForOpenapiMessages(onState: (payload: OpenAPIViewState) => void): () => void {
  const handler = (event: MessageEvent<OpenAPIExtensionMessage>) => {
    const message = event.data;
    if (message?.type === "openapiState") {
      onState(message.payload);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

declare function acquireVsCodeApi(): VsCodeApi;
