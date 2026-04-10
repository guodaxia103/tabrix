const codeExtensions = /\.(js|jsx|ts|tsx|vue)$/i;
const formatExtensions = /\.(json|md|yaml|html|css)$/i;

function quote(file) {
  return `"${file.replaceAll('"', '\\"')}"`;
}

function joinArgs(files) {
  return files.map(quote).join(' ');
}

function toPosix(file) {
  return file.replaceAll('\\', '/');
}

function packageRelative(files, prefix) {
  return files
    .map(toPosix)
    .filter((file) => file.startsWith(`${prefix}/`))
    .map((file) => file.slice(prefix.length + 1));
}

function buildWorkspaceCommands(files) {
  const commands = [];
  const codeFiles = files.filter((file) => codeExtensions.test(file)).map(toPosix);

  const extensionFiles = packageRelative(codeFiles, 'app/chrome-extension');
  if (extensionFiles.length > 0) {
    commands.push(
      `pnpm --dir app/chrome-extension exec eslint --fix --no-warn-ignored ${joinArgs(extensionFiles)}`,
    );
  }

  const nativeFiles = packageRelative(codeFiles, 'app/native-server');
  if (nativeFiles.length > 0) {
    commands.push(
      `pnpm --dir app/native-server exec eslint --fix --no-warn-ignored ${joinArgs(nativeFiles)}`,
    );
  }

  const sharedFiles = packageRelative(codeFiles, 'packages/shared');
  if (sharedFiles.length > 0) {
    commands.push(
      `pnpm --dir packages/shared exec eslint --fix --no-warn-ignored ${joinArgs(sharedFiles)}`,
    );
  }

  const rootFiles = codeFiles.filter(
    (file) =>
      !file.startsWith('app/chrome-extension/') &&
      !file.startsWith('app/native-server/') &&
      !file.startsWith('packages/shared/'),
  );
  if (rootFiles.length > 0) {
    commands.push(`eslint --fix --no-warn-ignored ${joinArgs(rootFiles)}`);
  }

  const prettierFiles = files
    .map(toPosix)
    .filter((file) => codeExtensions.test(file) || formatExtensions.test(file));
  if (prettierFiles.length > 0) {
    commands.push(`prettier --write ${joinArgs(prettierFiles)}`);
  }

  return commands;
}

export default {
  '**/*': buildWorkspaceCommands,
};
