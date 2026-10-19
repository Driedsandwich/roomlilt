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
| Vitest | Automated application tests | Recorded run: 58 tests passed across six files | Nothing blocking in this build | Run npm test | Yes — covers domain and HTTP behavior |
| happy-dom | Display tests with a simulated DOM | Actual display logic runs over real HTTP | Layout still needs browser tests | Create a Window; load the display module | Yes — checks display logic locally |
| Playwright + Chromium | Browser smoke tests and demo recording | Recorded run: two tests passed; real interactions recorded | Nothing blocking in this build | Install Chromium; run browser tests | Yes — verifies and records the visible flow |
| ffmpeg | Demo video assembly and audio normalization | Produced the 125.2-second H.264/AAC video | Local build lacks the drawtext filter | Provide recorded clips; run video assembly | Yes — combines recording, voices, and cards |
| macOS speech synthesis | Narrator Tom (Enhanced); assistant Ava (Premium) | Supplied both final demo voices locally | Nothing blocking in this build | Select installed voices; synthesize clips | Yes — provides separate offline voices |
| Browser Web Speech APIs | Optional voice input and spoken responses | Text and chips remain available as fallback | Availability and permissions vary by browser | Enable speech controls in a supported browser | Yes — adds optional hands-free interaction |
| AI coding agents | Implementation and review assistance | Helped the solo entrant build and review | Generated claims need code and test checks | Read the build spec; implement and verify | Yes — supports implementation with review |
| tsx | Runs TypeScript server and scripts | Executes the local TypeScript entry points | Nothing blocking in this build | Start the server through the npm script | Yes — supports the existing script workflow |
| concurrently | Starts server and web development processes | One command runs both with shared shutdown | Nothing blocking in this build | Run npm run dev | Yes — keeps local startup simple |

## Evaluated but not used

MCP Apps, Vega SDK, AWS services, and the preview Alexa+ tools were evaluated through documentation. MCP Apps required a different SDK package line. With about 20 GB free, the absence of disk requirements on the Vega 0.24 and 0.23 installation pages prevented an informed fit decision within the four-day solo build window. AWS promotional credits were exhausted per the October 7 update, so AWS use would have required the entrant's own billing account. See `FRICTION_LOG.md` entries 4, 6, and 7.
