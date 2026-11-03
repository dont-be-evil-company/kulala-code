declare global {
  interface Window {
    __KULALA__?: import("../../../shared/response-view").WebviewPayload;
    __KULALA_OPENAPI__?: import("../../../shared/openapi-view").OpenAPIViewState;
    __KULALA_GRAPHQL__?: import("../../../shared/graphql-view").GraphQLViewState;
    MonacoEnvironment?: {
      getWorker(moduleId: string, label: string): Worker;
    };
  }
}

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

export {};
