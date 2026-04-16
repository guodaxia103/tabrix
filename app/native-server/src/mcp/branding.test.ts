import { MCP_SERVER_INFO } from './mcp-server';
import { STDIO_MCP_SERVER_INFO, STDIO_PROXY_CLIENT_INFO } from './mcp-server-stdio';
import { looksLikeTabrixExtensionPath } from '../scripts/utils';

describe('Tabrix MCP branding', () => {
  it('uses Tabrix server names for HTTP and stdio transports', () => {
    expect(MCP_SERVER_INFO).toEqual({
      name: 'TabrixMcpServer',
      version: '1.0.0',
    });
    expect(STDIO_MCP_SERVER_INFO).toEqual({
      name: 'TabrixStdioMcpServer',
      version: '1.0.0',
    });
    expect(STDIO_PROXY_CLIENT_INFO).toEqual({
      name: 'Tabrix Stdio Proxy',
      version: '1.0.0',
    });
  });

  it('only detects Tabrix unpacked extension directories', () => {
    expect(looksLikeTabrixExtensionPath('C:\\work\\tabrix\\.output\\chrome-mv3')).toBe(true);
    expect(looksLikeTabrixExtensionPath('C:\\work\\mcp-chrome\\.output\\chrome-mv3')).toBe(false);
    expect(looksLikeTabrixExtensionPath('C:\\work\\other-extension')).toBe(false);
  });
});
