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
  id: string; signed_in: boolean; provider: string; display_name: string;
  credits: number; xp: number; level: number; level_progress: number; xp_next: number;
  seconds_played: number; time_credits: number;
  inventory: Record<CropKind, number>;
  stats: { planted: number; harvested: number; sold: number; credits_from_sales: number };
  plots_used: number; plots_limit: number;
  profile: FarmProfile;
  wallet: { address: string | null; status: string };
  payouts: FarmPayout[];
}
export interface FarmSnapshot {
  mode: 'farm_v1';
  account: FarmAccount | null;
  tiles: FarmTile[];
  bazaar: { position: FarmPosition; radius: number; prices: Record<CropKind, number> };
  crops: Record<CropKind, { label: string; sell: number; xp: number; grow_ms: [number, number] }>;
  rates: { credits_per_minute: number; lamports_per_credit: number; min_withdrawal_credits: number };
  auth: { provider: string; configured: boolean; signed_in: boolean };
  server_time: string;
}

export const CROPS: CropKind[] = ['wheat', 'carrot', 'pumpkin'];

async function read(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(String(body.error || 'The farm did not respond')), { status: response.status, code: body.code });
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
    const response = await fetch(`/api/world/farm/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return read(response);
  }

  async saveProfile(avatar: string, position: FarmPosition): Promise<Record<string, unknown>> {
    return this.post('profile', { avatar, position });
  }
}

interface ClerkShape {
  user: { fullName?: string | null; firstName?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null;
  session: { getToken(): Promise<string | null> } | null;
  load(options: { publishableKey: string }): Promise<void>;
  openSignIn(options?: Record<string, unknown>): unknown;
  signOut(): Promise<void>;
  addListener(listener: (state: { user: unknown }) => void): () => void;
}

function clerkFromWindow(): ClerkShape | undefined {
  return (window as unknown as { Clerk?: ClerkShape }).Clerk;
}

function loadClerkScript(): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>('script[data-clerk-browser]');
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkBrowser = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the sign-in service'));
    document.head.append(script);
  });
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
      if (!gateway.configured) return false;
      const clerk = await ensure();
      if (!clerk.user) {
        await new Promise<void>(resolve => {
          let settled = false;
          const finish = () => { if (settled) return; settled = true; unsubscribe(); clearInterval(poll); resolve(); };
          const unsubscribe = clerk.addListener(state => { if (state.user) finish(); });
          const poll = setInterval(() => { if (clerk.user) finish(); }, 500);
          try { clerk.openSignIn({ afterSignInUrl: location.href }); } catch { finish(); }
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
      if (!clerkFromWindow()) await loadClerkScript();
      const clerk = clerkFromWindow();
      if (!clerk) throw new Error('Sign-in service unavailable');
      await clerk.load({ publishableKey });
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
      accountButton.textContent = account.signed_in ? 'ACCOUNT' : snapshot.auth.configured ? 'SIGN IN' : 'GUEST';
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
    this.text('hud-hint', carrying ? 'Carry produce to the bazaar in the lower market' : 'Walk to glowing soil and press E to farm');
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
