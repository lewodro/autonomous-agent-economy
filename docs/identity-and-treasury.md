# Identity and treasury foundation

## What existed before

Last Seat already had signed anonymous visitor cookies, optional Clerk JWT verification,
a signed account cookie, a Postgres-backed world document, and a guest farm merge. It
also had internal-credit payout queue scaffolding and a public treasury-address feature
flag. Wallet addresses were self-declared, private experiments and gathered resources
remained owned by the guest visitor ID, and no authoritative treasury ledger/page existed.

## Ownership model

```text
Clerk subject
  └─ Last Seat user (stable usr_... ID)
      ├─ profile and saved character
      ├─ farm plots, progression and inventory
      ├─ internal credits and ledger
      ├─ gathered-resource receipts
      ├─ private experiments
      ├─ verified wallet links (zero or more)
      └─ future payout requests
```

Guests retain the signed anonymous session and can use the world without login. On
successful Clerk authentication, farm state, resource receipts and private experiments
are adopted into the account. Merge receipts make retries idempotent. Movement frames
are never written as durable ownership data.

Clerk JWT verification checks RS256 signature, issuer, expiry/not-before and the `azp`
authorized-party claim against `PUBLIC_ORIGIN` in production, following Clerk's manual
verification guidance: <https://clerk.com/docs/guides/sessions/manual-jwt-verification>.

## Wallet verification

Wallets are children of the Last Seat user, not user accounts themselves. The browser
discovers a Wallet Standard provider supporting `standard:connect` and
`solana:signMessage`. The server issues a five-minute challenge containing the domain,
Last Seat user ID, intended wallet, issued time, expiry and random nonce. The server
verifies the Ed25519 signature, consumes the challenge once, and stores a verified
Solana wallet link. A verified wallet cannot be claimed by another Last Seat account.

The challenge explicitly states that it links a public address and does not authorize a
transaction. Last Seat never asks for or stores a seed phrase or private key.

## Treasury boundary

`service/treasury.js` owns an append-only real-asset event ledger in a separate
`world_state` row (`treasury-ledger`). Its public projection powers:

* `GET /api/treasury/public`
* `GET /treasury`
* the Treasury House stall in the south market

The projection distinguishes reserve, reward allocation, outstanding payouts, available
reward budget and paid lifetime. Internal credits never enter this ledger and are not
automatically redeemable. When no public address/network/funding exists, the page says
**NOT FUNDED**, **NOT CONFIGURED** and **REAL PAYOUTS DISABLED** rather than inventing
values.

There is no mainnet executor in this phase. `WORLD_SOL_PAYOUTS_ENABLED=0` is the required
default. Any future executor must require a verified wallet, idempotent payout ID, caps,
confirmation/reconciliation and an external signer boundary.

## Production environment

| Group | Variable | Required now | Purpose |
|---|---|---:|---|
| Auth | `CLERK_PUBLISHABLE_KEY` | for login | Clerk frontend key and JWKS issuer |
| Auth | `HOST_SESSION_SECRET` | production | signs visitor/account cookies |
| Auth | `PUBLIC_ORIGIN` | production | request-origin allowlist |
| Auth | `WORLD_PUBLIC_DOMAIN` | production | binds wallet challenges to `lastseat.ing` |
| Database | `DATABASE_URL` | durable deployment | Postgres `world_state` storage |
| Treasury | `WORLD_TREASURY_ADDRESS` | no | public address only; never a signer key |
| Solana | `SOLANA_NETWORK` | no | `devnet`, `testnet`, or `mainnet-beta` display context |
| Feature flag | `WORLD_SOL_PAYOUTS_ENABLED` | yes | keep `0`; executor remains disabled |
| Economy | `WORLD_LAMPORTS_PER_CREDIT` | no | legacy disabled-payout bookkeeping; not a public exchange promise |

Optional integrations fail closed. Without Clerk, guest play remains available. Without
treasury configuration, the transparency page remains available and honestly reports an
unfunded/disabled state.
