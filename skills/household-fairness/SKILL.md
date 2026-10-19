---
name: household-fairness
description: Mediate a fictional household's shared resources with the RoomLilt MCP server, compare fairness impacts, and obtain explicit consent before saving or repairing agreements.
---

# Household fairness

Use a RoomLilt MCP connection over Streamable HTTP at `http://127.0.0.1:3001/mcp`.
The server negotiates protocol revisions through its SDK; the demo client uses `2025-11-25`. A committing client must support form-mode elicitation.

1. Call `get_household_state` and `get_fairness_ledger`. Read the demo date from the state. Treat all members and history as fictional. Protect fixed activities such as Maya's recovery sleep.
2. Call `find_conflicts` with that date. Resolve one conflict group at a time: call `propose_plans` using its exact `conflictId`, then complete steps 3–5 before finding the remaining conflicts again. Each proposal replaces this session's previous menu; re-propose a group if you need to return to it before choosing.
3. Present the returned alternatives. Explain each person's concrete time, room, or mode change; last-14-days yield counts split into required and negotiated yields; and bounded effort points. Compare the Fairest recommendation with the Lowest disruption option when they differ. Required yields still count toward fairness. Effort is a model of adjustment cost, not actual time lost.
4. Let the user choose an offered plan. Call `commit_plan` with its exact `planId`. The server must elicit explicit consent from every member making a change. A selected plan is not consent. Never fabricate an acceptance, silently accept for someone, or bypass the form.
5. On decline or cancel, report that nothing was committed. On acceptance, read the committed result and explain the saved agreement and ledger change. If the plan is stale, request fresh state and proposals; old consent cannot authorize changed terms.
6. When an event genuinely changes, call `report_change` with its `activityId` and `change` (`extend` with minutes in 15-minute increments, or `cancel`). Explain that this records the factual event immediately. Name the agreements identified by `keptAgreementIds`. Compare only the affected repair proposals and repeat the consent process for new adjustments.
7. Use `get_household_state` to answer “What did we agree?” and `get_fairness_ledger` to explain the cumulative burden. `reset_demo` restores the canonical day and removes demo agreements; use it when the user requests a reset.

Resources `household://state` and `household://ledger` offer JSON views. Prompt `resolve-household-fairly` provides a mediation starting point. Use the tools for mutations; reading a resource never changes state.

Respect refusal. Fairness scores inform the conversation; they do not override sleep, make an identity claim, or replace consent. A demonstration participant may play a fictional member, but production identity verification is outside this demo.
