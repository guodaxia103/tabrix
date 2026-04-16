import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupTools } from './register-tools';

export const MCP_SERVER_INFO = {
  name: 'TabrixMcpServer',
  version: '1.0.0',
} as const;

export const createMcpServer = () => {
  const server = new Server(MCP_SERVER_INFO, {
    capabilities: {
      tools: {},
    },
  });

  setupTools(server);
  return server;
};
