import * as fs from 'fs';
import * as path from 'path';

describe('config CLI action', () => {
  test('does not force process.exit after concurrent config fetches', () => {
    const cliSource = fs.readFileSync(path.resolve(__dirname, '../cli.ts'), 'utf8');
    const configStart = cliSource.indexOf(".command('config')");
    const clientsStart = cliSource.indexOf(".command('clients')", configStart);

    expect(configStart).toBeGreaterThanOrEqual(0);
    expect(clientsStart).toBeGreaterThan(configStart);

    const configAction = cliSource.slice(configStart, clientsStart);
    expect(configAction).toContain('process.exitCode = exitCode');
    expect(configAction).toContain('process.exitCode = 1');
    expect(configAction).not.toContain('process.exit(');
  });
});
