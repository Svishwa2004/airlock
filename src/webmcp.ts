/**
 * WebMCP type surface, verified empirically against Chrome 151 on 2026-08-26.
 * `navigator.modelContext` and `document.modelContext` are the same object.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: unknown;
  origin: string;
  title: string;
  window: unknown;
}

export interface ToolDefinition<TArgs> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: { readOnlyHint?: boolean };
  execute: (args: TArgs) => unknown | Promise<unknown>;
}

interface ModelContext {
  registerTool(tool: ToolDefinition<never>, options?: { signal?: AbortSignal }): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(tool: RegisteredTool, jsonArgs: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export const isSupported = (): boolean =>
  typeof document !== 'undefined' && 'modelContext' in document;

const registered = new Set<string>();

/**
 * Registers a tool and records its name for the status badge.
 *
 * `execute` is captured at registration time and is never re-registered, so
 * handlers must read live values from the module-level store rather than
 * closing over any snapshot.
 */
export async function registerTool<TArgs>(tool: ToolDefinition<TArgs>): Promise<void> {
  if (!document.modelContext) return;
  await document.modelContext.registerTool(tool as unknown as ToolDefinition<never>);
  registered.add(tool.name);
}

export const registeredNames = (): string[] => [...registered];
