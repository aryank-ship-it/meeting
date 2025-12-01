# Meeting Booking with Google Calendar + Meet Integration

This project demonstrates a simple meeting booking prototype using Node.js, Express, Nodemailer, and Google Calendar (with Meet link generation).

## Requirements
- Node.js v14 or higher
- An OAuth 2.0 Client ID and Secret from Google Cloud Console

## Setup & Run
1. Install dependencies:

```bash
npm install
```

2. (Optional but recommended) Set environment variables to avoid hard-coding secrets in the repo:

```bash
export GOOGLE_CLIENT_ID="<Your Google OAuth Client ID>"
export GOOGLE_CLIENT_SECRET="<Your Google OAuth Client Secret>"
export GOOGLE_REDIRECT_URI="http://localhost:5000/oauth2callback"

export GMAIL_USER="your-email@example.com" # used by Nodemailer
export GMAIL_APP_PASSWORD="your-app-password" # Gmail App password or OAuth
export ADMIN_EMAIL="admin@example.com" # Email that receives admin notifications
export ADMIN_PASS="strong_password_here" # Only to auto-create the first admin user (change it immediately after)
```

3. Start the server:

```bash
node server.js
```

4. Link Google Calendar for the server account (once):
- Visit: `http://localhost:5000/auth` in your browser.
- Grant access to your Google account.
- The server will save the refresh & access tokens in `google_tokens.json` during the OAuth callback.

5. Visit the frontend (served from `/public`):
- Visit: http://localhost:5000 (or http://localhost:5000/index.html) to fill the meeting request.

## Notes
- The event is added to the authenticated user’s Primary Google Calendar.
- The Google Meet link is created automatically and returned in the `/send-mail` response.
 - By default, the system sends an admin notification email and optionally a user confirmation email.
 - If you enable "Send Google Calendar invites to attendees" (via the admin settings), the app will create the calendar event with the attendee included and Google will send the invitation email to them. In that mode the service will skip sending an additional manual user email to avoid duplicate notifications.
- Do not commit `google_tokens.json` or any credentials to a public repository.
- If you see the error:
  "Cannot find module 'node:events'"
  -> Upgrade Node.js to v14+ (e.g., using `nvm install 18`).

## Google Cloud Console Setup
1. Go to https://console.cloud.google.com/
2. Create or select a project
3. Enable the Google Calendar API
4. Create OAuth 2.0 Client ID (type: Web application)
5. Add the redirect URI: `http://localhost:5000/oauth2callback`
6. Use the generated Client ID and Secret in environment variables or in `googleClient.js` (not recommended to commit)

## Security & Tips
- Prefer storing credentials in environment variables or secret managers (e.g., GitHub Secrets).
- Consider enabling more precise OAuth scopes.
- The app uses `sendUpdates: 'none'` to avoid automatically emailing attendees.

## Email settings
- Use `EMAIL_USER` and `EMAIL_PASS` for SMTP/SMTP app password configuration (preferred/simpler setup).
- Optional Gmail OAuth: configure `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` plus `GMAIL_USER` as an alternative.

## Troubleshooting
- Node version errors — upgrade Node to v14+.
- Problems right after linking — check server logs to see if token saves succeeded (`google_tokens.json`).
- If you see `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`, start a local MongoDB server or set `MONGODB_URI` to a working cluster.
- If you see `Failed to verify transporter: Invalid login: 535-5.7.8`, check your email transport method. Recommended steps:
  * If using SMTP (`EMAIL_USER` + `EMAIL_PASS`), make sure `EMAIL_PASS` is an app password for Gmail accounts with 2FA.
  * If using OAuth2, ensure the refresh token belongs to the same `GMAIL_USER` and was obtained with the Client ID/Secret currently configured.
  * If both OAuth and SMTP envs are present, the server now prefers SMTP (EMAIL_USER/EMAIL_PASS). Remove OAuth vars or set `EMAIL_PASS` if you prefer SMTP.
  * If your email provider is not Gmail, configure `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, and `EMAIL_SMTP_SECURE` in your `.env` so SMTP transport uses the correct host/port.

## Team Members (Admin)

- Admins can manage team members via the Admin Dashboard: add, remove, and view team members.
- Team members receive meeting notification emails whenever a user books a meeting (alongside the admin and the requestor).
- To manage team members, login to the Admin Dashboard and click "Team Members".

### How notifications work
- When a user schedules a meeting, the app creates a Google Calendar event (if Google OAuth is linked).
- The app sends a meeting notification email to:
  - The user who scheduled the meeting
  - The configured ADMIN_EMAIL
  - All team members stored in the database
   - Any guest emails added at booking time (they are added as attendees and receive invites/notifications as well)

### Stored booking data & Admin view
- When a user submits the booking form, the following data is stored per meeting in the database:
  - name, email, phone
  - attendees (guest emails)
  - companyName, industries, jobTitles
  - priority, monthlyContacts
  - message, start, end, hangoutLink, htmlLink, eventId
- Admin Dashboard > Meetings: Click the **View** button to see full booking details including attendees and the user-provided fields.

### Integrating Team Members
1. Start the server: `node server.js`.
2. Ensure MongoDB is running and your Google OAuth is linked (via `/auth`).
3. Login to the admin dashboard (create an admin using `ADMIN_EMAIL` & `ADMIN_PASS` env vars, or create admin via DB).
4. Add team members via the dashboard.
5. Test booking a meeting via the public booking page. Confirm:
   - The Google Calendar event is created.
   - A single consolidated notification email is sent to the user, the admin, and the team members.


### API Endpoints
- GET /admin/team-members — list all team members (requires admin auth)
- POST /admin/team-members — create a new member (body: { name, email, role })
- DELETE /admin/team-members/:id — delete a member

Example using curl:
```bash
curl -H "Authorization: Bearer <token>" http://localhost:5000/admin/team-members
curl -H "Authorization: Bearer <token>" -X POST http://localhost:5000/admin/team-members -d '{"name":"Alice","email":"alice@example.com","role":"support"}' -H 'Content-Type: application/json'
curl -H "Authorization: Bearer <token>" -X DELETE http://localhost:5000/admin/team-members/607d1f... 
```

## Security & Good Practice
- If you've accidentally exposed credentials (Client ID/Secret) in the code or repo, rotate the Client Secret in the Google Cloud Console immediately and update your environment variables.
- Use a `.env` file locally or environment variables on production to avoid committing secrets: copy `.env.example` -> `.env` and fill in values.

---
If you want, I can also make the server fail gracefully with a descriptive message when Node < 14 and add an environment-health endpoint that confirms the Google OAuth link status.
