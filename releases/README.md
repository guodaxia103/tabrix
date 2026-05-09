# Tabrix Extension Releases

This directory is release guidance for extension assets. The authoritative
distribution source is GitHub Releases.

## Download

Download the latest extension zip from
[GitHub Releases](https://github.com/guodaxia103/tabrix/releases).

The asset name should be versioned, for example:

```text
tabrix-extension-vX.Y.Z.zip
```

Notes:

- Use the versioned asset published on GitHub Releases as the source of truth.
- `releases/chrome-extension/latest/`, if present locally, is a temporary build
  directory and is not a public distribution source.

## Install

1. Unzip the downloaded asset.
2. Open Chrome.
3. Navigate to `chrome://extensions/`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped extension directory.

## Verify

- The Tabrix extension icon appears in the browser toolbar.
- The extension popup opens.
- The popup shows the expected connection and server status.

## Native Server Connection

1. Ensure the Tabrix native server is running. The default port is `12306`.
2. Enter the correct port in the extension popup if needed.
3. Use the popup connection action to verify the bridge.

## Troubleshooting

### Extension does not load

- Confirm `Developer mode` is enabled.
- Confirm the selected directory is the unpacked extension root.

### Native server does not connect

- Confirm the native server is running.
- Confirm the port is correct.
- Check the browser console and Tabrix logs.

### Browser behavior is unexpected

- Refresh the target page.
- Reload the extension.
- Restart Chrome if the extension or Native Messaging bridge is stale.

## Security

This extension has broad browser permissions. Install only assets from trusted
release sources.
