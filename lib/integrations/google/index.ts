// lib/integrations/google: the only place that talks to Google. Callers (Workers, through the Connectors architecture) use `GoogleWorkspace`; everything else is exported for tests and the views.
export * from "./core";
export * from "./operations";
export * from "./view";
export { GoogleWorkspace, type ConnectionActivity, type ExecutionRecord, type Seen, type WorkspaceResult } from "./workspace";
export * as gmail from "./gmail";
export * as calendar from "./calendar";
export * as drive from "./drive";
