# Submission fields

| Devpost field | Text / value |
| --- | --- |
| Project name | RoomLilt |
| Tagline | A free slot is not always a fair slot. Household scheduling that protects fixed needs, remembers who yielded, and asks before saving a change. |
| Primary track | Alexa+ |
| Mini challenges | Open Source (fields below) |
| Built with | TypeScript; Node.js 22; MCP TypeScript SDK 1.32.1; MCP specification 2025-11-25; Streamable HTTP; Express; Zod; Vite; HTML; CSS; browser Web Speech APIs; Vitest; happy-dom; Playwright + Chromium; tsx; concurrently; ffmpeg; Kokoro (kokoro-onnx); Python; AI coding agents |
| Team / development disclosure | Solo entrant; built during the submission period with AI coding agents. |
| Existing-project explanation | Built during the submission period as a new project. |

## Open Source mini challenge

| Required field | Value |
| --- | --- |
| Contribution URL | https://github.com/Driedsandwich/mcp-wire-inspector |
| Project repository URL | https://github.com/Driedsandwich/roomlilt |
| GitHub username | Driedsandwich |

**What we did.** We extracted RoomLilt's Protocol inspector into a new, separate MIT-licensed package, `mcp-wire-inspector`, and generalized it beyond this app.

**How it works.** `instrumentTransport` wraps a transport of the official MCP TypeScript SDK by intercepting outgoing `send` calls and incoming `onmessage` messages without changing their behavior. A bounded recorder classifies each JSON-RPC message, pairs responses with requests by ID to measure latency, and masks secret-looking values before storing them: values under keys such as authorization, token, API key, password, cookie and secret, the value of secret-named header pairs, and Bearer tokens, JWTs and common key prefixes inside strings, while keeping MCP's own `progressToken` and `maxTokens` visible. Masking is best-effort. `summarize` derives the negotiated protocol version, server name, and tool count from the recorded traffic. An optional dependency-free DOM panel shows a filterable, expandable message list with copy and export. The package has 60 tests, including a real Streamable HTTP session with a bidirectional elicitation round trip against the SDK server.

**Why it matters.** Browser-based MCP clients, such as simulated assistant front ends, are hard to debug and hard to demonstrate: a screenshot of a result does not show whether the client really spoke MCP. Adding the recorder and panel makes initialization, tool calls, and elicitation visible to developers, teammates, and judges.

## Project story

```markdown
# RoomLilt

**A free slot is not always a fair slot.** RoomLilt compares **Fairest** with **Lowest disruption** so a household can see when the smallest immediate change asks the same person to yield again. In the demo, judges will see protected sleep, a history-aware evening choice, explicit consent, saved agreements, and a repair that preserves unrelated decisions.

## Inspiration

A household planner can minimize today's disruption while repeatedly asking the same person to give way. RoomLilt explores a specific alternative: protect fixed needs, make the cost of flexible changes visible, and consider who has already yielded before asking for consent.

Maya needs recovery sleep after a night shift; Sam's laundry must move to protect it. Later, Sam and Leo both want the living room. That sequence makes the difference between necessary accommodation and repeated discretionary sacrifice visible.

## What it does

RoomLilt finds connected schedule conflicts, proposes feasible changes, compares **Fairest** with **Lowest disruption**, and saves a plan only after every person making a change explicitly consents.

In the fixed demo day, Sam's laundry move is a **Required yield** because protected sleep cannot move. After Sam accepts, his last-14-days history becomes nine yields. For the evening conflict, delaying Sam's game night costs 1.5 effort points; moving Leo's reading to the private study costs 2. The fairness-aware recommendation asks Leo this time, using the actual ledger rather than silently choosing the smaller immediate adjustment.

Declining or cancelling consent leaves the proposed plan unsaved. Accepted agreements and the ledger persist in a local JSON file. When Leo's meeting runs 30 minutes late, RoomLilt replans the affected meeting/class conflict and keeps the unrelated laundry and evening agreements.

The web display supports text, suggestion chips, optional browser speech, and a Protocol inspector that exposes real Model Context Protocol (MCP) initialization, discovery, tool calls, and form elicitation.

## How we built it

RoomLilt was built during the hackathon submission period by a **solo entrant with AI coding agents**. The agents assisted development; they are not additional human team members.

The application is a self-hosted **MCP server targeting specification 2025-11-25 over stateful Streamable HTTP**, paired with a real web MCP client. Both server and client import and call the pinned official **MCP TypeScript SDK 1.32.1 at runtime**: `src/server/app.ts` uses `McpServer` and `StreamableHTTPServerTransport`; `src/client/mcp.ts` uses `Client` and `StreamableHTTPClientTransport`. Consent travels through `elicitation/create` before commit.

Node.js, TypeScript, Express, and Zod support the server. Vite builds the browser UI. A deterministic English intent router maps supported phrases to actual tools. The solver uses declared flexible windows, room alternatives, quiet modes, and minimum durations; it does not invent permissions from activity names. JSON writes use atomic replacement, and revision checks reject stale proposals.

This follows the Alexa+ track's self-hosted MCP and web-simulation path described in its guidance and FAQ. The application runs locally without AWS services or paid APIs.

The 119.0-second English demo was recorded from real browser interactions with Playwright and assembled with ffmpeg at 1280×800 in H.264/AAC. Kokoro, an open-weight speech model run locally, supplies the narrator (`am_michael`) and assistant (`af_heart`) voices.

## Challenges we ran into

Protocol compliance needed careful version negotiation: the requirement names 2025-11-25 while a later published revision and the SDK version constants differed. The application targets 2025-11-25 and lets the SDK negotiate newer initialize requests down to that supported revision.

A second standalone event-stream probe returned HTTP 409 because the SDK client had already opened its GET stream. This integration friction is recorded in `FRICTION_LOG.md` entry 1.

An internal review before recording found four problems: generic plan titles, demo-specific hard-coding in the solver, effort counted in raw minutes that ballooned for large moves, and a protocol-version check that rejected newer clients instead of negotiating. All four were fixed: titles describe the actual change, the solver reads only declared alternatives, effort is bounded at 1–3 points per adjustment, and version negotiation is left to the SDK.

## Accomplishments that we're proud of

The implemented result connects an inspectable protocol flow to a concrete household decision: protected sleep stays fixed, necessary yields still count in the ledger, and an evening recommendation can favor a slightly more disruptive change to avoid asking Sam again.

Automated domain, router, persistence, and real HTTP tests cover refusal/cancellation, stale consent, protocol negotiation, and repair that preserves unrelated agreements. Recorded verification passed with 65 tests across six files and two separate rendered-browser smoke tests.

## What we learned

The implementation makes three distinctions concrete: feasibility is different from fairness; a proposal is different from an agreement; and receiving a changed fact is different from obtaining consent to a repair. Modeling those separately makes the explanation, stored state, and protocol trace agree.

## Potential impact

RoomLilt is intended for shared homes: roommates, multigenerational families, and households balancing shift work or remote work. Sleep, calls, classes, and shared-room plans can compete even when each person's calendar looks reasonable in isolation. In a home where everyone already talks to a shared voice assistant, that device is a natural place to explain the trade-off and ask the person affected. Beyond the hackathon, RoomLilt could become an Alexa+ add-on once supported access is available. Its MCP server is reusable by other MCP clients; committing agreements requires a client that supports form elicitation.

## Scope and limitations

RoomLilt presents a **simulated Alexa+-style experience**, not an actual Alexa+ integration, and is **not affiliated with Amazon**. Amazon's partner-only preview Category SDK, MCP Toolkit, CLI, and Web Simulator were not used. All household data is **fictional**. Consent is **role-based**: a demonstrator responds as Sam or Leo, without authenticated member identities. The fixed 14-day ledger and bounded effort points illustrate a fairness policy; they have not been validated with real households. The deterministic English router handles supported phrases, and optional browser speech depends on platform support.

## What's next

Before use with real households, the next work is authenticated member consent, a rolling history, and evaluation of fairness preferences with people who would use the product. Broader language understanding and calendar integrations would need to preserve the current constraints and consent boundary. An Alexa+ add-on would also need integration validation once access is available.
```

## Product feedback

```markdown
# Product feedback

RoomLilt was built during the submission period by a solo entrant with AI coding agents. The feedback below covers the implementation tools and the documentation used to select the Alexa+ track. Onboarding describes the local setup path; no onboarding duration was measured.

## MCP TypeScript SDK 1.32.1

- **Used for:** Runtime Model Context Protocol (MCP) server and browser client, stateful Streamable HTTP, tool/resource/prompt discovery, structured tool results, and form elicitation before committing an agreement. The imports and calls are in `src/server/app.ts` and `src/client/mcp.ts`.
- **What worked well:** One SDK supplies both transport ends and the consent request/result schemas. The project's real HTTP tests exercise acceptance, refusal, cancellation, missing elicitation capability, session handling, restart loading, and revision changes during pending consent. The display exposes actual protocol messages for inspection.
- **What needs work:** The automatic standalone GET stream was not obvious during integration probing: a second GET received 409 because the SDK client had already opened one. Examples should explain stream ownership. Separately, MCP Apps 2.0.3 required the split v2 package line; a compatibility/migration guide would help an entrant starting from the documented 1.x SDK. See `FRICTION_LOG.md` entries 1 and 4.
- **Onboarding (zero to hello world):** Install the pinned package on Node 22, create `McpServer` plus `StreamableHTTPServerTransport`, and connect `Client` using `StreamableHTTPClientTransport`. Discovery provides a first checkpoint; elicitation and negotiated-version traces then make the stateful workflow inspectable.
- **Build again?:** **Yes.** It supplies the protocol behavior this project needs on both sides, and the observed stream-probing issue was resolved without replacing it.

## MCP specification 2025-11-25

- **Used for:** Streamable HTTP sessions and headers, initialization/version negotiation, and form elicitation. The server targets 2025-11-25, and the web client requests and verifies that revision.
- **What worked well:** Initialization, discovery, execution, and consent are distinct protocol steps that can be tested over HTTP and shown in the Protocol inspector. The official [transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) sections provide the implementation reference.
- **What needs work:** The October 19 research found a current site revision of 2026-07-28 while both inspected SDK lines reported 2025-11-25 as latest. Combined with the hackathon wording about later confirmed versions, this left acceptance unclear. Publish a cross-reference between specification revisions, SDK support, and the revisions the hackathon accepts. See `FRICTION_LOG.md` entry 3.
- **Onboarding (zero to hello world):** Start with initialize and tools/list on one revision, then add a tool call and consent. The build initially rejected nonmatching versions too early; review corrected it to use SDK negotiation, with tests for newer requests negotiating 2025-11-25 and SDK-supported older behavior.
- **Build again?:** **Yes.** The explicit transport and consent boundaries support a verifiable local integration; version support can be pinned and checked.

## Hackathon Alexa+ track guidance and FAQ

- **Used for:** Choosing the self-hosted MCP plus web-simulation path, identifying submission requirements, and deciding not to depend on partner-only tooling. Source: the [hackathon site](https://amazonappdev2026.devpost.com) Overview, Resources, Official Rules and FAQ as read on October 19, 2026.
- **What worked well:** The FAQ explains the partner-only preview-tool restriction and permits an entrant-built web frontend. It also says a locally runnable repository plus video is sufficient, so continuous hosting is unnecessary. This supported a local implementation.
- **What needs work:** Preview-tool access is stated in the FAQ but not on the Overview or Resources pages, both read on October 19. Move that statement beside the Alexa+ setup guidance, list accepted MCP revisions, and recommend a tested SDK line with an MCP Apps migration example. Align the schedule tab's October 26 judging start with the rules' November 9 start. Promotional credits were exhausted per the October 7 update, so AWS use would have required the entrant's own billing account; credit instructions should reflect that update. See `FRICTION_LOG.md` entries 2–5 and 7.
- **Onboarding (zero to hello world):** Read Overview, Resources, Official Rules, and FAQ together; choose the self-hosted MCP route, then connect a web client and demonstrate a tool call with consent.
- **Build again?:** **Yes, using the documented open MCP route.** It is achievable without preview access; clearer access and compatibility guidance would reduce selection uncertainty.

## Other tools used

| Tool | Used for | What worked well | What needs work | Onboarding (zero to hello world) | Build again? |
| --- | --- | --- | --- | --- | --- |
| Node.js 22 | Local server and scripts | One runtime for the local workflow | Nothing blocking in this build | Install dependencies; run the server | Yes — supports the local application |
| TypeScript | Typed server, client, scripts, and tests | Build checks types before bundling | Nothing blocking in this build | Install; run the build's type check | Yes — checks shared data shapes |
| Express | HTTP endpoint and middleware | Hosts the SDK transport on loopback | Nothing blocking in this build | Create an app; mount the MCP endpoint | Yes — fits the small local server |
| Zod | MCP tool argument schemas | Declares tool input constraints | Nothing blocking in this build | Define a schema for one tool | Yes — keeps tool inputs explicit |
| Vite | Browser development and production bundle | Bundles the real SDK client | Nothing blocking in this build | Start development server with MCP proxy | Yes — supports both development and build |
| Vitest | Automated application tests | Recorded run: 65 tests passed across six files | Nothing blocking in this build | Run npm test | Yes — covers domain and HTTP behavior |
| happy-dom | Display tests with a simulated DOM | Actual display logic runs over real HTTP | Layout still needs browser tests | Create a Window; load the display module | Yes — checks display logic locally |
| Playwright + Chromium | Browser smoke tests and demo recording | Recorded run: two tests passed; real interactions recorded | Nothing blocking in this build | Install Chromium; run browser tests | Yes — verifies and records the visible flow |
| ffmpeg | Demo video assembly and audio normalization | Produced the 119.0-second H.264/AAC video | Local build lacks the drawtext filter | Provide recorded clips; run video assembly | Yes — combines recording, voices, and cards |
| Kokoro text-to-speech (kokoro-onnx) | Narrator (`am_michael`) and assistant (`af_heart`) voices: 18 clips in 14 segments | Runs locally with Apache-2.0 model weights; no network service, account, or API key. Chosen because macOS system voices are licensed for personal, non-commercial use only | Nothing blocking in this build | Install `kokoro-onnx` and `soundfile` in Python; download two model files (about 205 MB) | Yes — local narration that can be published |
| Browser Web Speech APIs | Optional voice input and spoken responses | Text and chips remain available as fallback | Availability and permissions vary by browser | Enable speech controls in a supported browser | Yes — adds optional hands-free interaction |
| AI coding agents (OpenAI Codex and Claude Code) | Codex implemented code and drafted documents from written specifications; Claude Code reviewed and fixed code, ran tests and browser checks, and recorded the video | Helped the solo entrant build and review | Generated claims need code and test checks | Read the build spec; implement and verify | Yes — supports implementation with review |
| tsx | Runs TypeScript server and scripts | Executes the local TypeScript entry points | Nothing blocking in this build | Start the server through the npm script | Yes — supports the existing script workflow |
| concurrently | Starts server and web development processes | One command runs both with shared shutdown | Nothing blocking in this build | Run npm run dev | Yes — keeps local startup simple |

## Evaluated but not used

MCP Apps, Vega SDK, AWS services, and the preview Alexa+ tools were evaluated through documentation. MCP Apps required a different SDK package line. With about 20 GB free, the absence of disk requirements on the Vega 0.24 and 0.23 installation pages prevented an informed fit decision within the four-day solo build window. AWS promotional credits were exhausted per the October 7 update, so AWS use would have required the entrant's own billing account. See `FRICTION_LOG.md` entries 4, 6, and 7.
```

## Optional feature requests

```markdown
# Feature requests

1. **Important — One ungated Alexa+ onboarding path on the track page.** State beside the Alexa+ Overview/Resources instructions that the Category SDK, MCP Toolkit, CLI, and Web Simulator are partner-only. Link a self-hosted Streamable HTTP example with a real web client and form elicitation. Preview-tool access is stated in the FAQ but not on the Overview or Resources pages, both read on October 19. That answer should be visible before entrants select an architecture. Basis: `FRICTION_LOG.md` entry 2.

2. **Important — An explicit MCP compatibility matrix.** List accepted protocol revisions and a tested SDK/package line; explain the relationship between `@modelcontextprotocol/sdk` 1.x, the split v2 packages, and MCP Apps. The rules' wording about later confirmed versions and the Apps peer-dependency split made compliance and package selection uncertain. A migration example or v1-compatible Apps path would reduce mid-build rework. Basis: `FRICTION_LOG.md` entries 3–4.

3. **Important — Installation footprints and a lightweight Vega simulator route.** Publish download, installed, temporary-space, and RAM requirements for each supported release. With about 20 GB free and no disk requirement stated on the 0.24 or 0.23 installation pages, the entrant could not determine whether the install would fit the four-day solo build window. Basis: `FRICTION_LOG.md` entry 6.

4. **Important — Synchronized schedule and credit-availability notices.** Align the Devpost judging dates with Official Rules §1, and put the October 7 exhausted-credit notice beside every credit offer/request instruction. Promotional credits were exhausted per that update, so AWS use would have required the entrant's own billing account. A no-card AWS development path would help late joiners assess the mini challenge without that billing commitment. Basis: `FRICTION_LOG.md` entries 5 and 7.
```

## Optional friction log

```markdown
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
```

## Testing instructions

```markdown
1. Use Node.js 22.12 or newer within the Node 22 release line, with npm. In the downloaded project directory, run `npm install`, then `npm run demo:reset`, then `npm run dev`.
2. Open `http://127.0.0.1:5173`. The MCP server is `http://127.0.0.1:3001/mcp`; the web app uses the real SDK client through Vite's `/mcp` proxy. No account, API key, paid service, or physical device is needed.
3. Ask **“What's clashing today?”**, then **“Find a fair plan.”** Choose the laundry proposal. Decline once and observe that no agreement was saved; choose it again and accept as Sam. The required yield protects Maya's sleep and updates Sam's history.
4. Ask **“Who gets the living room tonight?”** Compare Lowest disruption (Sam delays game night) with Fairest (Leo reads in the private study). Choose the recommended plan and accept as Leo.
5. Expand **Protocol inspector** to inspect the raw `initialize` response for `protocolVersion: 2025-11-25`, `tools/list`, `tools/call`, and `elicitation/create` messages.
6. Reload or reconnect and ask **“What did we agree?”** For the stronger persistence check, stop the development process, run `npm run dev` again, and reload: accepted agreements and history load from the local file.
7. Ask **“Leo's meeting runs 30 minutes late.”** The meeting/class conflict is replanned; kept laundry and evening agreements remain visible. Choose the repair and accept as the named changing member.
8. Run `npm run build` and `npm test` for typechecking, production build, and automated checks. For browser checks, run `PLAYWRIGHT_BROWSERS_PATH=./data/browser-cache npx playwright install chromium`, then `npm run test:browser`.

Reset restores the local demo state. Do not run multiple servers against the same data file. Text and suggestion chips work without a microphone. Keep the service bound to the local machine.
```
