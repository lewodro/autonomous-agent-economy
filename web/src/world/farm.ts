export type CropKind = 'wheat' | 'carrot' | 'pumpkin';
export interface FarmPosition { x: number; y: number }
export interface FarmTile {
  id: string; position: FarmPosition; stage: 'wild' | 'growing' | 'ready'; anchor: string;
  crop: CropKind | null; ready_at: string | null; ready_in_ms: number; mine: boolean; growth: number;
}
export interface FarmPayout {
  id: string; amount_credits: number; amount_lamports: number; status: string;
  requested_at: string; wallet_address: string; note: string;
}
export interface FarmProfile {
  avatar: string | null; position: FarmPosition | null; saved_at: string | null;
}
export interface FarmAccount {
  id: string; user_id: string; temporary: boolean; signed_in: boolean; provider: string; display_name: string;
  credits: number; xp: number; level: number; level_progress: number; xp_next: number;
  seconds_played: number; time_credits: number;
  inventory: Record<CropKind, number>;
  stats: { planted: number; harvested: number; sold: number; credits_from_sales: number };
  plots_used: number; plots_limit: number;
  profile: FarmProfile;
  ledger: Array<{ id: string; type: string; timestamp: string; details: Record<string, unknown> }>;
  wallet: { address: string | null; status: string; links: Array<{ id: string; chain: string; address: string; verified_at: string | null; created_at: string; primary: boolean }> };
  payouts: FarmPayout[];
}

interface WalletStandardAccount { address: string; publicKey: Uint8Array; features: readonly string[] }
interface WalletStandardWallet {
  name: string;
  accounts: readonly WalletStandardAccount[];
  features: Record<string, { connect?: () => Promise<unknown>; signMessage?: (...inputs: Array<{ account: WalletStandardAccount; message: Uint8Array }>) => Promise<Array<{ signedMessage: Uint8Array; signature: Uint8Array }>> }>;
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let output = '';
  while (value > 0n) { output = alphabet[Number(value % 58n)] + output; value /= 58n; }
  for (const byte of bytes) { if (byte === 0) output = `1${output}`; else break; }
  return output || '1';
}

/** Discovers Wallet Standard providers without taking transaction authority. */
export async function connectAndSignWallet(messageProvider: (address: string) => Promise<{ id: string; message: string }>): Promise<{ challenge_id: string; wallet_address: string; signature: string }> {
  const found = new Set<WalletStandardWallet>();
  const register = (...wallets: WalletStandardWallet[]) => wallets.forEach(wallet => found.add(wallet));
  const listener = (event: Event) => (event as CustomEvent<(api: { register: typeof register }) => void>).detail({ register });
  window.addEventListener('wallet-standard:register-wallet', listener);
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register } }));
  await new Promise(resolve => window.setTimeout(resolve, 60));
  window.removeEventListener('wallet-standard:register-wallet', listener);
  const wallet = [...found].find(candidate => candidate.features['standard:connect']?.connect && candidate.features['solana:signMessage']?.signMessage);
  if (!wallet) throw new Error('Install or unlock a Solana Wallet Standard wallet first.');
  await wallet.features['standard:connect']!.connect!();
  const account = wallet.accounts.find(value => value.features.includes('solana:signMessage')) || wallet.accounts[0];
  if (!account) throw new Error(`${wallet.name} did not expose a Solana account.`);
  const challenge = await messageProvider(account.address);
  const outputs = await wallet.features['solana:signMessage']!.signMessage!({ account, message: new TextEncoder().encode(challenge.message) });
  const signature = outputs?.[0]?.signature;
  if (!signature) throw new Error(`${wallet.name} did not return a signature.`);
  return { challenge_id: challenge.id, wallet_address: account.address, signature: encodeBase58(signature) };
}
export interface FarmSnapshot {
  mode: 'farm_v1';
  account: FarmAccount | null;
  tiles: FarmTile[];
  bazaar: { position: FarmPosition; radius: number; prices: Record<CropKind, number> };
  crops: Record<CropKind, { label: string; sell: number; seed_cost: number; xp: number; unlock_level: number; grow_ms: [number, number]; production_grow_ms: number }>;
  rates: { credits_per_minute: number; lamports_per_credit: number; min_withdrawal_credits: number };
  auth: { provider: string; configured: boolean; signed_in: boolean };
  server_time: string;
}

export const CROPS: CropKind[] = ['wheat', 'carrot', 'pumpkin'];

async function read(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code : '';
  const friendly: Record<string, string> = {
    NOT_ENOUGH_CREDITS: 'You need more credits for that crop.',
    TOO_FAR: 'Walk closer to the farm plot.',
    PLOT_OCCUPIED: 'Another visitor claimed this plot first.',
    PLOT_LIMIT: 'You are already tending the maximum number of plots.',
    CROP_NOT_READY: 'This crop is still growing.',
    NOT_OWNER: 'This crop belongs to another visitor.',
    INVENTORY_TOO_LOW: 'You do not carry enough of that resource.',
    MARKET_REQUIRED: 'Carry your produce to the Market before selling.',
    LEVEL_REQUIRED: 'Raise your farming level to unlock this crop.',
    PLAYER_NOT_FOUND: 'Reconnect to the shared world and try again.',
  };
  if (!response.ok) throw Object.assign(new Error(friendly[code] || String(body.error || 'The farm did not respond')), { status: response.status, code });
  return body;
}

/** Thin client for the server-authoritative farm. The browser never decides growth or prices. */
export class FarmClient {
  snapshot: FarmSnapshot | null = null;

  async load(): Promise<FarmSnapshot> {
    const response = await fetch('/api/world/farm', { signal: AbortSignal.timeout(6_000) });
    this.snapshot = await read(response) as unknown as FarmSnapshot;
    return this.snapshot;
  }

  async post(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const idempotent = ['plant', 'harvest', 'sell'].includes(action);
    const payload = idempotent && body.request_id === undefined ? { ...body, request_id: crypto.randomUUID() } : body;
    let failure: unknown;
    for (let attempt = 0; attempt < (idempotent ? 2 : 1); attempt += 1) {
      try {
        const response = await fetch(`/api/world/farm/${action}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(6_000),
        });
        return await read(response);
      } catch (error) {
        failure = error;
        if (error && typeof error === 'object' && 'status' in error) throw error;
      }
    }
    throw failure instanceof Error ? failure : new Error('The farm did not respond');
  }

  async saveProfile(avatar: string, position: FarmPosition): Promise<Record<string, unknown>> {
    return this.post('profile', { avatar, position });
  }
}

interface ClerkShape {
  user: { fullName?: string | null; firstName?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
  session: { getToken(): Promise<string | null> } | null;
  load(options?: { ui?: { ClerkUI: unknown } }): Promise<void>;
  openSignIn(options?: Record<string, unknown>): unknown;
  signOut(): Promise<void>;
  addListener(listener: (state: { user: unknown }) => void): () => void;
}

interface ClerkWindow extends Window {
  Clerk?: ClerkShape;
  __internal_ClerkUICtor?: unknown;
}

function clerkFromWindow(): ClerkShape | undefined {
  return (window as ClerkWindow).Clerk;
}

/** Clerk publishable keys encode the deployment-specific Frontend API hostname. */
export function clerkFrontendApi(publishableKey: string): string | null {
  const match = publishableKey.match(/^pk_(?:test|live)_(.+)$/);
  const encoded = match?.[1];
  if (!encoded) return null;
  try {
    const decoded = atob(encoded).replace(/\$$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(decoded) ? decoded : null;
  } catch { return null; }
}

function appendClerkScript(src: string, marker: string, publishableKey?: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[${marker}]`);
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load the sign-in service')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute(marker, '1');
    if (publishableKey) script.setAttribute('data-clerk-publishable-key', publishableKey);
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error('Could not load the sign-in service'));
    document.head.append(script);
  });
}

let clerkScripts: Promise<void> | null = null;
function loadClerkScript(publishableKey: string): Promise<void> {
  if (clerkFromWindow()) return Promise.resolve();
  if (clerkScripts) return clerkScripts;
  clerkScripts = (async () => {
    const frontendApi = clerkFrontendApi(publishableKey);
    if (!frontendApi) throw new Error('The sign-in service key is invalid');
    const origin = `https://${frontendApi}`;
    await appendClerkScript(`${origin}/npm/@clerk/ui@1/dist/ui.browser.js`, 'data-clerk-ui');
    await appendClerkScript(`${origin}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, 'data-clerk-browser', publishableKey);
  })().catch(error => { clerkScripts = null; throw error; });
  return clerkScripts;
}

export interface AuthGateway {
  configured: boolean;
  signedIn: boolean;
  signIn(): Promise<boolean>;
  signOut(): Promise<void>;
}

/** Clerk is loaded lazily and only when the deployment exposes a publishable key. */
export function createAuth(getConfig: () => Promise<{ configured: boolean; publishable_key: string | null }>): AuthGateway {
  let pending: Promise<ClerkShape> | null = null;
  let publishableKey = '';
  const gateway: AuthGateway = {
    configured: false,
    signedIn: false,
    async signIn() {
      const clerk = await ensure();
      if (!clerk.user) {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = () => { if (settled) return; settled = true; unsubscribe(); clearInterval(poll); resolve(); };
          const fail = (error: unknown) => { if (settled) return; settled = true; unsubscribe(); clearInterval(poll); reject(error); };
          const unsubscribe = clerk.addListener(state => { if (state.user) finish(); });
          const poll = setInterval(() => { if (clerk.user) finish(); }, 500);
          try { clerk.openSignIn(); } catch (error) { fail(error); }
        });
      }
      if (!clerk.user) return false;
      const token = await clerk.session?.getToken();
      if (!token) return false;
      await read(await fetch('/api/world/auth/clerk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }));
      gateway.signedIn = true;
      return true;
    },
    async signOut() {
      const clerk = clerkFromWindow();
      if (clerk?.user) { try { await clerk.signOut(); } catch { /* local cookie still clears */ } }
      try { await read(await fetch('/api/world/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); } catch { /* offline sign-out is harmless */ }
      gateway.signedIn = false;
    },
  };
  async function ensure(): Promise<ClerkShape> {
    if (!publishableKey) {
      const config = await getConfig();
      if (!config.configured || !config.publishable_key) throw new Error('Social login is not configured');
      publishableKey = config.publishable_key;
      gateway.configured = true;
    }
    if (!pending) pending = (async () => {
      if (!clerkFromWindow()) await loadClerkScript(publishableKey);
      const clerk = clerkFromWindow();
      if (!clerk) throw new Error('Sign-in service unavailable');
      const ClerkUI = (window as ClerkWindow).__internal_ClerkUICtor;
      if (!ClerkUI) throw new Error('Sign-in interface unavailable');
      await clerk.load({ ui: { ClerkUI } });
      return clerk;
    })().catch(error => { pending = null; throw error; });
    return pending;
  }
  return gateway;
}

/** Minimal RPG strip and the top-left notice stack. */
export class FarmHud {
  private $(id: string) { return document.getElementById(id); }

  show(snapshot: FarmSnapshot): void {
    const root = this.$('world-hud'); root?.removeAttribute('hidden');
    const account = snapshot.account;
    if (!account) return;
    this.text('hud-name', account.display_name.toUpperCase());
    const accountButton = this.$('hud-account') as HTMLButtonElement | null;
    if (accountButton) {
      accountButton.textContent = account.signed_in ? 'ACCOUNT' : 'TEMP ACCOUNT';
      accountButton.dataset.signedIn = String(account.signed_in);
    }
    this.text('hud-level', `LV ${account.level}`);
    const bar = this.$('hud-xp-bar'); if (bar) bar.style.width = `${Math.round(account.level_progress * 100)}%`;
    this.text('hud-credits', `${account.credits} CR`);
    this.text('hud-plots', `PLOTS ${account.plots_used}/${account.plots_limit}`);
    const bag = this.$('hud-bag');
    if (bag) {
      bag.replaceChildren();
      for (const kind of CROPS) {
        const amount = account.inventory[kind] || 0;
        const chip = document.createElement('span');
        chip.className = `hud-crop hud-crop--${kind}${amount ? '' : ' empty'}`;
        chip.textContent = `${kind.slice(0, 2).toUpperCase()} ${amount}`;
        bag.append(chip);
      }
    }
    const carrying = CROPS.reduce((sum, kind) => sum + (account.inventory[kind] || 0), 0);
    this.text('hud-hint', carrying ? 'Carry produce to the bazaar in the lower market' : 'Explore beyond the plaza for soil and resources');
  }

  private text(id: string, value: string): void {
    const node = this.$(id);
    if (node && node.textContent !== value) node.textContent = value;
  }

  notice(message: string, tone: 'info' | 'good' | 'warn' = 'info'): void {
    const stack = this.$('farm-notices');
    if (!stack) return;
    const item = document.createElement('div');
    item.className = `farm-notice farm-notice--${tone}`;
    item.textContent = message;
    stack.prepend(item);
    while (stack.children.length > 4) stack.lastElementChild?.remove();
    window.setTimeout(() => item.classList.add('is-leaving'), 4_200);
    window.setTimeout(() => item.remove(), 4_800);
  }
}
