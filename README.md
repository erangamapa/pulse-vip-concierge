# pulse-vip-concierge

The private telegram service for high value customers. Each VIP talks to a concierge agent in their own chat. The agent can request things. It cannot approve anything. Every approval is a human account manager.

## What it does

A VIP can ask about their tier and benefits, ask for a bigger max stake for a big event, ask for a custom deal, or set up a bet. The agent answers from tier scoped knowledge and files requests on their behalf.

The classic case is a world cup finals week limit change. The agent collects the kind of limit, the value and the event. It then shows a card with the exact wording and two buttons. Only a tap on the confirm button files the request. The request goes to the loyalty service with `filedBy` set to the agent, and the status comes back as pending. When a manager decides, the chat gets a message.

## Rules I enforce in code

- An unknown chat gets one polite refusal. It never reaches the model and it gets no tools.
- Identity comes from a verified binding between a chat and a customer. A manager issues a one time link code and the customer redeems it with `/start CODE` from their own private chat. The model never supplies who it is acting for.
- The tool registry throws at construction if any tool name sounds like authority. Place, approve, decide, set, cancel and similar verbs are refused. There is no placement tool to misuse because there is none to wire.
- Knowledge is filtered by the customer's tier inside the store, before ranking. The model passes a query string and nothing else, so a gold customer cannot retrieve diamond terms.
- Every gated action shows a card written by code, not by the model. The outcome line after a tap is also written by code from the tool result. The model cannot claim an approval that did not happen.
- A bet confirmation mints a `confirmationRef` at the moment of the tap. The bet is re-priced after the tap. If the price moved, nothing is handed off.
- Every inbound update, outbound message and tool effect is appended to an audit log. Inbound text is masked for personal data.

## Layout

```
src/index.ts              http server, /healthz, graceful shutdown
src/bot.ts                grammY wiring. identity, then audit, then conversation
src/identity.ts           chat to customer bindings and link codes
src/conciergeAgent.ts     agentloop harness, role concierge, the tools
src/conversation.ts       transport free turn handling and pending confirmations
src/flows/                card and status wording for limits, deals and bets
src/knowledge/store.ts    tier filtered retrieval
src/audit.ts              audit log interface
src/notify.ts             signed manager decision webhook
```

`conversation.ts` knows nothing about grammY. `bot.ts` is the only file that does, and `index.ts` is the only file that opens a socket. Tests push plain update objects through `bot.handleUpdate` with the api calls intercepted, so there is no network and no real bot token.

## Webhooks

Telegram posts to `/telegram`. The server checks the secret token header that telegram sends. There is no long polling.

The manager tooling posts decisions to `/webhooks/manager-decision` with a hex HMAC SHA256 of the raw body in the `x-signature` header. The body names the type (`limit_request` or `deal`), the id, the customer, the status and who decided.

## Running it

The sibling repos must sit next to this one.

```
../agentloop
../sportsbook-contracts
```

```
cd ../sportsbook-contracts/packages/ts && npm install
cd ../../../agentloop && npm install
cd ../pulse-vip-concierge && npm install
npm run typecheck
npm test
```

Neither sibling has a build output, so the test and type config point at their source directly. Copy `.env.example` to `.env` and fill the values to run the server with `npm start`. To build the image, run `docker build -f pulse-vip-concierge/Dockerfile .` from the folder that holds all three repos.

## Not done

Bindings, pending confirmations and the audit log are in memory. They are behind small interfaces and a restart loses them. The pgvector knowledge store is described in a comment and not built. The placement queue belongs to pulse-agents, so here it is an interface with an http client and an in memory fake.
