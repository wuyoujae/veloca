# Waitlist

## Overview

The waitlist module supports the Veloca official prototype page. It collects early-access email addresses through a small Node.js and Express service and stores the data in a local JSON file. The current implementation does not send email; it records the request and tells users that the registration code will be sent to the submitted email later.

## Runtime

Run the official landing page and API together:

```bash
npm run dev:official
```

The server listens on `127.0.0.1` and serves the page from the `offical` directory. By default, the page is available at:

```text
http://127.0.0.1:8787/offical.html
```

## Configuration

The server reads `.env` from the project root before starting. The supported variables are:

```env
VELOCA_OFFICIAL_PORT=8787
VELOCA_WAITLIST_FILE=.veloca/waitlist/waitlist.json
```

`VELOCA_WAITLIST_FILE` defaults to `.veloca/waitlist/waitlist.json`. The `.veloca/` directory is ignored by Git so local user emails are not committed.

## API

### `POST /api/waitlist`

Request body:

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

Status conventions:

- `status: 1` means the waitlist record is active.
- `registrationCodeStatus: 0` means no registration code has been sent yet.

## Local Storage Structure

The JSON file uses this shape:

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

Duplicate emails are not inserted twice. Instead, the existing record updates `lastSubmittedAt`, `updatedAt`, and `submissionCount`.

## Validation And Safety

The endpoint validates email format and length, limits JSON body size to `10kb`, applies a small in-memory rate limit per IP address, and stores a SHA-256 hash of the IP address instead of the raw IP. File writes are serialized in-process and written through a temporary file before rename to reduce partial-write risk.
