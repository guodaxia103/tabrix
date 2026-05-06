import type { PrimaryTabController } from '../runtime/primary-tab-controller';
import { bridgeRuntimeState } from '../server/bridge-state';
import { extractTabIdFromCallToolResult } from './task-context-key';

export function resolvePrimaryTabOutgoingArgs(
  name: string,
  args: any,
  primaryTabController: PrimaryTabController,
): any {
  if (name !== 'chrome_navigate') return args;
  const callerSuppliedTabId =
    args && typeof args === 'object' && Number.isInteger((args as any).tabId);
  if (callerSuppliedTabId) return args;

  const injected = primaryTabController.getInjectedTabId();
  if (injected === null) return args;
  return { ...args, tabId: injected };
}

export function recordPrimaryTabNavigationOutcome(input: {
  name: string;
  args: any;
  response: any;
  primaryTabController: PrimaryTabController;
}): void {
  const { name, args, response, primaryTabController } = input;
  if (name !== 'chrome_navigate') return;
  const responseTabId =
    response && response.status === 'success' && response.data && typeof response.data === 'object'
      ? extractTabIdFromCallToolResult(response.data)
      : null;
  const url =
    args && typeof args === 'object' && typeof (args as any).url === 'string'
      ? ((args as any).url as string)
      : null;
  primaryTabController.recordNavigation({ returnedTabId: responseTabId, url });
  const ptSnapshot = primaryTabController.getSnapshot();
  bridgeRuntimeState.setPrimaryTabSnapshot({
    primaryTabId: ptSnapshot.primaryTabId,
    primaryTabReuseRate: ptSnapshot.primaryTabReuseRate,
    benchmarkOwnedTabCount: ptSnapshot.benchmarkOwnedTabCount,
  });
}
