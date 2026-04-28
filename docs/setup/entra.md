# Entra (Azure AD) app registration (one-time)

This sets up Microsoft Entra as the identity provider. Supabase's "Azure" auth provider is the SDK side; this is the IdP side.

Performed in the Entra admin center by an account with **Application Administrator** or **Cloud Application Administrator** role. Typically: USI's IT admin.

## 1. Register the application

1. [Entra admin center](https://entra.microsoft.com) → **Applications** → **App registrations** → **New registration**.
2. Name: `cyber-attainment-worksheet`.
3. Supported account types: **Accounts in this organizational directory only** (single tenant — USI).
4. Redirect URI: select **Web**, then add:
   - `https://<supabase-project-ref>.supabase.co/auth/v1/callback`
   (Get the value from Supabase Studio → Authentication → URL Configuration → Auth callback URL.)
5. Register.
6. Copy down:
   - **Application (client) ID** → `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → `ENTRA_TENANT_ID`

## 2. Create a client secret

Certificates & secrets → **New client secret**. Description: `supabase-auth`. Expiry: 24 months (set a calendar reminder; Phase 4 should automate rotation but doesn't yet).

**Copy the secret value immediately** (only shown once) → `ENTRA_CLIENT_SECRET`.

## 3. Configure token claims

Token configuration → **Add optional claim**:

- ID token: `email`, `family_name`, `given_name`, `upn`
- Access token: `email`

Click **Yes** when prompted to also enable the Microsoft Graph permission required for these claims (`profile`, `email`).

## 4. Configure API permissions

API permissions → **Add a permission** → **Microsoft Graph** → **Delegated permissions**:

- `openid`
- `profile`
- `email`
- `offline_access`
- `User.Read`

Click **Grant admin consent for USI**. Status should turn green for all five.

## 5. (Optional, recommended) Create app roles

App roles → **Create app role**. Two roles:

| Display name | Allowed member types | Value | Description |
|---|---|---|---|
| Editor | Users/Groups | `editor` | Can edit assessment scores. |
| Viewer | Users/Groups | `viewer` | Read-only access to assessments. |

These roles surface as `roles` claims in the ID token. Phase 2+ uses them for an additional layer of access control beyond the database `memberships` table.

## 6. Assign users

Enterprise applications → `cyber-attainment-worksheet` → Users and groups → **Add user/group**.

Initial assignments (suggested):

- **CIO** (you) — Editor
- **CL board distribution group** — Viewer
- **AHP board distribution group** — Viewer
- (Repeat per tenant)

## 7. Wire it up in Supabase

Supabase Studio → Authentication → Providers → **Azure**:

- **Enabled:** ✅
- **Azure Tenant URL:** `https://login.microsoftonline.com/<ENTRA_TENANT_ID>`
- **Client ID:** `<ENTRA_CLIENT_ID>`
- **Client Secret:** `<ENTRA_CLIENT_SECRET>`

Save.

## 8. Smoke test

Visit `https://<supabase-project>.supabase.co/auth/v1/authorize?provider=azure&redirect_to=https://caw-collision-leaders.vercel.app/`.

You should bounce through Microsoft's login → consent → land back on the Vercel URL. In Supabase Studio → Authentication → Users, your user should appear with provider `azure`. In `public.profiles`, the trigger should have created your row automatically.

## Common failure modes

| Symptom | Fix |
|---|---|
| "AADSTS50011: redirect URI mismatch" | The Supabase callback URL isn't in the Entra app's redirect URI list. Add it. |
| Login succeeds but no `profiles` row | The signup trigger (`fn_handle_new_user`) didn't run. Check `db/migrations/0004_triggers.sql` was applied. |
| Login succeeds but no membership granted | Domain not in `domain_whitelist`, or domain matches but trigger ordering is off. Insert the membership manually. |
