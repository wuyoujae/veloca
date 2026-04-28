# Veloca Official

Standalone official landing page prototype for Veloca, including a local Express waitlist API.

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:8787/offical.html
```

## Configuration

Copy the example environment file when local overrides are needed:

```bash
cp .env.example .env
```

Available variables:

| Variable | Default | Description |
| --- | --- | --- |
| `VELOCA_OFFICIAL_PORT` | `8787` | Local server port. |
| `VELOCA_WAITLIST_FILE` | `.veloca/waitlist/waitlist.json` | Local JSON file for waitlist records. Relative paths are resolved from this `offical` directory. |

## Waitlist API

`POST /api/waitlist`

```json
{
  "email": "user@example.com"
}
```

Successful response:

```json
{
  "code": 0,
  "data": {
    "alreadyJoined": false,
    "email": "user@example.com",
    "id": "uuid",
    "registrationCodeStatus": 0,
    "status": 1
  },
  "message": "You are on the waitlist. We will send your registration code to this email."
}
```

The local storage file uses this structure:

```json
{
  "version": 1,
  "createdAt": "2026-04-29T00:00:00.000Z",
  "updatedAt": "2026-04-29T00:00:00.000Z",
  "entries": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "source": "official-landing",
      "status": 1,
      "registrationCodeStatus": 0,
      "submissionCount": 1,
      "ipHash": "sha256",
      "userAgent": "browser user agent",
      "createdAt": "2026-04-29T00:00:00.000Z",
      "updatedAt": "2026-04-29T00:00:00.000Z",
      "lastSubmittedAt": "2026-04-29T00:00:00.000Z"
    }
  ]
}
```

Duplicate emails update `submissionCount`, `updatedAt`, and `lastSubmittedAt` instead of creating duplicate entries.
