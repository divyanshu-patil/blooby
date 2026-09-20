import { McpPanel, PageHeader } from '@blooby/studio';

/** The editor's MCP tab, on the dashboard too: connecting an app is not a per-project thing. */
export function AiClients() {
  return (
    <>
      <PageHeader title="AI apps" subtitle="Let Claude, ChatGPT, Cursor and other AI apps animate for you." />
      <div className="page-body ai-clients"><McpPanel /></div>
    </>
  );
}
