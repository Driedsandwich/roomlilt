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

The 137.6-second English demo was recorded from real browser interactions with Playwright and assembled with ffmpeg at 1280×800 in H.264/AAC. macOS speech synthesis supplies Tom (Enhanced) for the narrator and Ava (Premium) for the assistant. Near the end, a 12-second scene shows Claude Code, an existing AI assistant, connecting to the same MCP server over Streamable HTTP and reading the saved agreements and fairness ledger.

## Challenges we ran into

Protocol compliance needed careful version negotiation: the requirement names 2025-11-25 while a later published revision and the SDK version constants differed. The application targets 2025-11-25 and lets the SDK negotiate newer initialize requests down to that supported revision.

A second standalone event-stream probe returned HTTP 409 because the SDK client had already opened its GET stream. This integration friction is recorded in `FRICTION_LOG.md` entry 1.

An internal review before recording found four problems: generic plan titles, demo-specific hard-coding in the solver, effort counted in raw minutes that ballooned for large moves, and a protocol-version check that rejected newer clients instead of negotiating. All four were fixed: titles describe the actual change, the solver reads only declared alternatives, effort is bounded at 1–3 points per adjustment, and version negotiation is left to the SDK.

## Accomplishments that we're proud of

The implemented result connects an inspectable protocol flow to a concrete household decision: protected sleep stays fixed, necessary yields still count in the ledger, and an evening recommendation can favor a slightly more disruptive change to avoid asking Sam again.

Automated domain, router, persistence, and real HTTP tests cover refusal/cancellation, stale consent, protocol negotiation, and repair that preserves unrelated agreements. Recorded verification passed with 58 tests across six files and two separate rendered-browser smoke tests.

## What we learned

The implementation makes three distinctions concrete: feasibility is different from fairness; a proposal is different from an agreement; and receiving a changed fact is different from obtaining consent to a repair. Modeling those separately makes the explanation, stored state, and protocol trace agree.

## Potential impact

RoomLilt is intended for shared homes: roommates, multigenerational families, and households balancing shift work or remote work. Sleep, calls, classes, and shared-room plans can compete even when each person's calendar looks reasonable in isolation. In a home where everyone already talks to a shared voice assistant, that device is a natural place to explain the trade-off and ask the person affected. Beyond the hackathon, RoomLilt could become an Alexa+ add-on once supported access is available. Its MCP server is reusable by other MCP clients; committing agreements requires a client that supports form elicitation.

## Scope and limitations

RoomLilt presents a **simulated Alexa+-style experience**, not an actual Alexa+ integration, and is **not affiliated with Amazon**. Amazon's partner-only preview Category SDK, MCP Toolkit, CLI, and Web Simulator were not used. All household data is **fictional**. Consent is **role-based**: a demonstrator responds as Sam or Leo, without authenticated member identities. The fixed 14-day ledger and bounded effort points illustrate a fairness policy; they have not been validated with real households. The deterministic English router handles supported phrases, and optional browser speech depends on platform support.

## What's next

Before use with real households, the next work is authenticated member consent, a rolling history, and evaluation of fairness preferences with people who would use the product. Broader language understanding and calendar integrations would need to preserve the current constraints and consent boundary. An Alexa+ add-on would also need integration validation once access is available.
