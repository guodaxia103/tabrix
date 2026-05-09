# Why MCP on Chrome?

This page gives a short public comparison between Tabrix and common browser
automation approaches.

## Three Differences

| Dimension   | Tabrix                                                                                              | Playwright MCP / browser-use style tools                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browser     | The user's daily real Chrome session, including existing login state.                               | A separate Chromium or Playwright runtime, often without the user's logged-in session.               |
| AI client   | Any MCP-capable assistant or host, such as Cursor, Claude Desktop, Codex CLI, or other MCP clients. | Often exposed as a library, SDK, or dedicated automation runtime that needs extra integration work.  |
| Setup model | Chrome extension plus local `tabrix` bridge.                                                        | Frequently requires browser binary download, Playwright setup, or a separate automation environment. |

## Good Fit

Use Tabrix when you need to:

- operate websites where the user is already logged in, such as admin systems,
  internal tools, GitHub repositories, CMS, CRM, or support tools;
- expose the same real browser session to different MCP clients;
- keep browser state local by default while still supporting controlled LAN
  access when needed;
- debug or verify assistant browser actions against the user's actual Chrome
  profile.

## Poor Fit

Tabrix is not the best first choice when you need:

- large-scale headless crawling with high concurrency;
- a pure CLI automation path with no browser extension;
- fully unattended automation over sensitive logged-in sessions without any
  operator-side policy or permission model.

## One Sentence

Tabrix turns the Chrome session the user already trusts into an MCP-native
browser execution layer for AI assistants. It does not start from a clean,
throwaway browser profile by default.
