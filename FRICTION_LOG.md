# Friction log

These entries record actual build friction and the entrant's October 19, 2026 track-selection research. Entries 2–7 come from the review of the hackathon pages and public documentation. Severity is the impact assessment for this project.

## 1. A duplicate event-stream probe received HTTP 409

- **Task attempted:** Verify GET `/mcp` event streaming with the real SDK client.
- **Steps:** Connected, discovered tools, then sent another GET for the same session.
- **Expected:** The extra GET would return 200 with an event stream.
- **Actual:** It returned 409 because the SDK had already opened its standalone GET stream after initialization.
- **Severity:** Low.
- **Workaround:** Observed SDK fetch responses to assert the original GET returned 200 with `text/event-stream`. Asserted a duplicate standalone GET receives 409.
- **Actionable suggestion:** Transport examples should explicitly explain the automatic GET and one-standalone-stream-per-session behavior so integration probes test the intended connection.

## 2. Alexa+ preview-tool access was stated in the FAQ but not on Overview or Resources

- **Task attempted:** Select an achievable Alexa+ build path on October 19.
- **Steps:** Read the Overview and Resources pages and the FAQ on October 19, including access to the Category SDK, MCP Toolkit, CLI, and Web Simulator.
- **Expected:** The track's Overview/Resources section would state which developer tools a hackathon entrant could access.
- **Actual:** The FAQ states that those add-on tools are partner-only and that hackathon participants cannot obtain access. That access statement was absent from the Overview and Resources pages read on October 19. The FAQ permits a self-hosted MCP server with an entrant-built web client instead.
- **Severity:** Medium; affected initial track and architecture selection.
- **Workaround:** Built a self-hosted MCP server and its own real web MCP client in a simulated Alexa+-style display.
- **Actionable suggestion:** Put the preview-access limitation and supported self-hosted path directly in the Alexa+ Overview and Resources sections, with the FAQ link beside them.

## 3. The accepted MCP revision was ambiguous

- **Task attempted:** Choose a compliant MCP protocol revision on October 19.
- **Steps:** Compared the rules' 2025-11-25 requirement, including the phrase “or a later version, once confirmed,” with the MCP site's current revision and SDK version constants.
- **Expected:** One explicit list of accepted protocol revisions and a matching SDK recommendation.
- **Actual:** The MCP site listed 2026-07-28 as current, while `@modelcontextprotocol/sdk` 1.32.1 and `@modelcontextprotocol/core` 2.3.1 both reported `LATEST_PROTOCOL_VERSION = '2025-11-25'`. Whether 2026-07-28 counted as confirmed was unclear.
- **Severity:** Medium; affected compliance and transport configuration.
- **Workaround:** Targeted 2025-11-25 explicitly and allowed SDK negotiation with newer clients. The repository tests newer initialize requests receiving 2025-11-25 rather than rejecting them before negotiation.
- **Actionable suggestion:** Name accepted revisions explicitly in the rules and link a tested SDK/version combination for each supported path.

## 4. MCP Apps and the documented SDK used different package lines

- **Task attempted:** Evaluate MCP Apps for display cards on October 19.
- **Steps:** Compared the judging examples' MCP Apps suggestion with `@modelcontextprotocol/ext-apps` 2.0.3 peer dependencies and the project's SDK 1.32.1 path.
- **Expected:** A clear compatible route from the widely documented `@modelcontextprotocol/sdk` 1.x package to MCP Apps.
- **Actual:** `ext-apps` 2.0.3 declared the split `@modelcontextprotocol/server`, `client`, and `core` packages at `^2.0.0`. Adding it would have required switching SDK lines during the hackathon.
- **Severity:** Medium; changed the display integration approach.
- **Workaround:** Rendered structured tool-result cards in the project's own web MCP client. MCP Apps was evaluated, not installed or used.
- **Actionable suggestion:** Publish a migration note or a v1-compatible MCP Apps path, and tell Alexa+ entrants which SDK line is recommended.

## 5. Published judging dates disagreed

- **Task attempted:** Check the judging schedule on October 19.
- **Steps:** Compared the Devpost schedule tab with Official Rules §1.
- **Expected:** Matching judging dates in both places.
- **Actual:** The schedule tab showed October 26–November 20; Official Rules §1 showed November 9–November 20.
- **Severity:** Low; introduced planning uncertainty.
- **Workaround:** Retained the discrepancy in this log for submission feedback.
- **Actionable suggestion:** Align the schedule tab, rules, and FAQ, and identify the authoritative schedule beside any change notice.

## 6. Vega installation lacked a stated disk footprint

- **Task attempted:** Evaluate Fire TV/Vega on October 19 within a four-day solo build window, ending at the October 23, 2026, 12:00 PT deadline.
- **Steps:** Reviewed `/docs/vega/latest/install-vega-sdk.html`, which redirected to 0.24, and the 0.24 and 0.23 installation pages. Compared their prerequisites with about 20 GB of free laptop storage.
- **Expected:** Disk and RAM requirements sufficient to decide whether the SDK and virtual device would fit.
- **Actual:** The path required Homebrew packages, Rosetta 2 on Apple silicon, the Vega Virtual Device, and shell-profile edits, with an optional VS Code extension. Neither reviewed installation version stated disk requirements, so fit could not be judged.
- **Severity:** Medium; prevented a confident track-selection decision within the build window.
- **Workaround:** Chose the Alexa+ self-hosted MCP path. Vega was evaluated through documentation, not installed or tested.
- **Actionable suggestion:** State download size, installed disk footprint, temporary installation space, and RAM needs, and offer a lightweight simulator path.

## 7. AWS promotional credits were unavailable to late joiners

- **Task attempted:** Evaluate the AWS Builder mini challenge on October 19.
- **Steps:** Reviewed the promotional-credit information and the October 7 Resources/Rules update.
- **Expected:** Clear availability information before choosing a credit-dependent build path.
- **Actual:** Promotional credits were exhausted per the October 7 update, so AWS use would have required the entrant's own billing account.
- **Severity:** Medium; constrained the feasible mini-challenge scope.
- **Workaround:** Kept this project local and did not enter the AWS Builder mini challenge. RoomLilt entered only the Open Source mini challenge, which required no AWS use.
- **Actionable suggestion:** Display credit availability prominently wherever credits are offered, reconcile older request instructions with the update, and offer a no-card development path.
