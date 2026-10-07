# Model request permissions

Model credentials and destinations are server configuration, not agent authority.
For an OpenAI-compatible provider, set `MODEL_BASE_URL` on the server (default:
`https://api.openai.com/v1`) and `MODEL_API_KEY_ENV` to the dedicated environment
variable holding its credential (default: `OPENAI_API_KEY`).

An agent's optional `inference.base_url` and `inference.api_key_env` must match
those server settings. Imported configurations cannot select another destination
or another credential. Request redirects are disabled. The legacy HTTP adapter
uses only the server's `AGENT_HTTP_ENDPOINT` and `AGENT_HTTP_TOKEN`.

When public model inference is enabled in production, off-box provider endpoints
must use HTTPS so server-side bearer credentials are not sent in plaintext.
HTTP is accepted only for loopback model services on the same host. Development
may use HTTP on a private network; secure that network separately.

Keep local/private model endpoints explicit in server configuration. Public agent
prompts, configs and replays must never contain credentials. Failed permission
checks fall back to a local action without consuming inference budget or making
a network request.

Public production rejects model-backed match creation by default, including
funded Devnet matches and provider-backed replay imports. To opt in, set
`ENABLE_PUBLIC_MODEL_INFERENCE=true`; the server then accepts at most two new
model-backed sessions per minute per process. This is a server-paid capability:
each match has a bounded inference budget, but enabling it lets visitors spend
the deployment's configured provider budget. Monitor provider usage and set
provider-side spending limits before enabling it. Mock matches remain available
without this flag or any model credentials.

Provider responses contribute only the validated action and target. Any provider
free-text reason is discarded; the server creates a short spectator summary from
the structured action so private reasoning cannot enter the replay event stream.

Inference reservations count each UTF-8 request byte plus the configured maximum
output tokens. This deliberately overestimates typical context token counts;
failed requests and retries still consume the reservation. Invalid numeric costs
or limits cannot reduce the budget. These are local limits, not billing receipts.
