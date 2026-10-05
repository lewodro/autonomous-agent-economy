# Model request permissions

Model credentials and destinations are server configuration, not agent authority.
For an OpenAI-compatible provider, set `MODEL_BASE_URL` on the server (default:
`https://api.openai.com/v1`) and `MODEL_API_KEY_ENV` to the dedicated environment
variable holding its credential (default: `OPENAI_API_KEY`).

An agent's optional `inference.base_url` and `inference.api_key_env` must match
those server settings. Imported configurations cannot select another destination
or another credential. Request redirects are disabled. The legacy HTTP adapter
uses only the server's `AGENT_HTTP_ENDPOINT` and `AGENT_HTTP_TOKEN`.

Keep local/private model endpoints explicit in server configuration. Public agent
prompts, configs and replays must never contain credentials. Failed permission
checks fall back to a local action without consuming inference budget or making
a network request.

Inference reservations count each UTF-8 request byte plus the configured maximum
output tokens. This deliberately overestimates typical context token counts;
failed requests and retries still consume the reservation. Invalid numeric costs
or limits cannot reduce the budget. These are local limits, not billing receipts.
