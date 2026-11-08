# Google sign-in production setup

Last Seat uses Clerk for authentication. The application verifies Clerk session JWTs
against Clerk's public JWKS and creates its own durable Last Seat user record. Google is
an authentication provider; email and wallet addresses are not database primary keys.

## 1. Create the Clerk production instance

1. Open **Clerk Dashboard** and select the Last Seat application.
2. Use the instance picker at the top and choose **Create production instance**.
3. Open **Configure → Domains** and complete the DNS records Clerk shows for
   `lastseat.ing`. Clerk notes that production DNS can take time to propagate.
4. Open **Configure → API keys** and copy the production publishable key beginning
   `pk_live_`. Do not put the secret key in browser code.

Clerk's production guide is the source of truth:
<https://clerk.com/docs/guides/development/deployment/production>.

## 2. Enable Google in Clerk

1. In the production instance, open **SSO connections**.
2. Select **Add connection → For all users → Google**.
3. Enable **sign-up and sign-in**.
4. Enable **Use custom credentials** (required for production).
5. Copy the **Authorized Redirect URI** shown by Clerk. Use that exact value in
   Google Cloud; do not guess or substitute a Last Seat callback URL.

Official provider guide:
<https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google>.

## 3. Create the Google OAuth client

1. Open **Google Cloud Console → APIs & Services** and select or create the Last Seat
   project.
2. Configure the **OAuth consent screen**. Use the Last Seat name, support contact,
   authorized domain `lastseat.ing`, and only the basic identity scopes Clerk needs.
3. Open **Credentials → Create credentials → OAuth client ID**.
4. Choose **Web application**.
5. Add `https://lastseat.ing` under **Authorized JavaScript origins**. Add the `www`
   origin only if that hostname is actually served.
6. Paste Clerk's exact Authorized Redirect URI under **Authorized redirect URIs**.
   Google requires an exact match, including scheme and trailing slash.
7. Create the client and copy its Client ID and Client Secret.

Google's redirect rules:
<https://developers.google.com/identity/protocols/oauth2/web-server>.

## 4. Finish Clerk and publish Google OAuth

1. Return to the Google connection in Clerk.
2. Paste the Google Client ID and Client Secret into **Use custom credentials** and
   save.
3. In Google Cloud's OAuth consent screen, add test users while testing.
4. Before public launch, change the Google OAuth app from **Testing** to
   **In production** and complete any verification Google requests. Clerk warns that
   production apps should not rely on Google's testing status.
5. In Clerk **Account Portal**, open the production sign-in page and test Google.
   Check Clerk Application Logs for `oauth_callback.failed` if it fails.

## 5. Render variables and deploy

Set these on the Render web service, then redeploy:

```text
CLERK_PUBLISHABLE_KEY=pk_live_...
HOST_SESSION_SECRET=<at least 32 random characters>
PUBLIC_ORIGIN=https://lastseat.ing
WORLD_PUBLIC_DOMAIN=lastseat.ing
DATABASE_URL=<Render Postgres internal URL>
```

This code does not call Clerk's Backend API, so `CLERK_SECRET_KEY` is not currently
read. Keep it in Render only if a later webhook or Backend API integration requires it.

## 6. Test the complete Last Seat flow

1. Open a private browser window at `https://lastseat.ing/world`.
2. Enter as a guest and move once.
3. Open **Character / Account → Sign in and link this account**.
4. Continue with Google in Clerk.
5. Confirm you return to the same world and the account shows signed in.
6. Refresh and confirm the same display profile, inventory, farm state, credits and
   private experiments remain attached.
7. Repeat with a second Google account and confirm the two accounts cannot see or
   mutate one another's private state.

Discord, GitHub and Email can be enabled later in Clerk's SSO/authentication settings;
they resolve into the same Clerk subject and Last Seat ownership model.
