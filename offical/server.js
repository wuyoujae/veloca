import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const defaultPort = 8787;
const defaultWaitlistFile = '.veloca/waitlist/waitlist.json';
const sourceName = 'official-landing';
const rateLimitWindowMs = 60 * 1000;
const maxRequestsPerWindow = 8;

loadLocalEnv();

const officialDir = dirname(fileURLToPath(import.meta.url));
const app = express();
const configuredPort = Number.parseInt(process.env.VELOCA_OFFICIAL_PORT ?? `${defaultPort}`, 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : defaultPort;
const configuredWaitlistFile = process.env.VELOCA_WAITLIST_FILE ?? defaultWaitlistFile;
const waitlistFile = isAbsolute(configuredWaitlistFile)
  ? configuredWaitlistFile
  : resolve(officialDir, configuredWaitlistFile);
const requestBuckets = new Map();

let writeQueue = Promise.resolve();

app.disable('x-powered-by');
app.use((request, response, next) => {
  const origin = request.get('origin');

  if (!origin || origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin || '*');
    response.setHeader('Vary', 'Origin');
  }

  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(officialDir));

app.get('/api/health', (_request, response) => {
  response.json({
    code: 0,
    data: { service: 'veloca-waitlist', status: 'ok' },
    message: 'ok'
  });
});

app.post('/api/waitlist', async (request, response) => {
  const rateLimitResult = checkRateLimit(request.ip);

  if (!rateLimitResult.allowed) {
    response.status(429).json({
      code: 429,
      data: null,
      message: 'Too many requests. Please try again later.'
    });
    return;
  }

  const email = normalizeEmail(request.body?.email);

  if (!isValidEmail(email)) {
    response.status(400).json({
      code: 400,
      data: null,
      message: 'Please enter a valid email address.'
    });
    return;
  }

  try {
    const result = await enqueueWaitlistWrite(() =>
      saveWaitlistEntry({
        email,
        ipAddress: request.ip,
        userAgent: request.get('user-agent') ?? ''
      })
    );

    response.status(result.created ? 201 : 200).json({
      code: 0,
      data: {
        alreadyJoined: !result.created,
        email: result.entry.email,
        id: result.entry.id,
        registrationCodeStatus: result.entry.registrationCodeStatus,
        status: result.entry.status
      },
      message: 'You are on the waitlist. We will send your registration code to this email.'
    });
  } catch (error) {
    console.error('Failed to save waitlist entry:', error);
    response.status(500).json({
      code: 500,
      data: null,
      message: 'Unable to join the waitlist right now. Please try again later.'
    });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Veloca waitlist server is running at http://127.0.0.1:${port}/offical.html`);
  console.log(`Waitlist data file: ${waitlistFile}`);
});

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 254) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkRateLimit(ipAddress) {
  const key = ipAddress || 'unknown';
  const now = Date.now();
  const bucket = requestBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return { allowed: true };
  }

  bucket.count += 1;
  return { allowed: bucket.count <= maxRequestsPerWindow };
}

function enqueueWaitlistWrite(operation) {
  const nextWrite = writeQueue.then(operation, operation);
  writeQueue = nextWrite.catch(() => {});
  return nextWrite;
}

function saveWaitlistEntry({ email, ipAddress, userAgent }) {
  const now = new Date().toISOString();
  const waitlist = readWaitlist();
  const existingEntry = waitlist.entries.find((entry) => entry.email === email);

  if (existingEntry) {
    existingEntry.updatedAt = now;
    existingEntry.lastSubmittedAt = now;
    existingEntry.submissionCount += 1;
    waitlist.updatedAt = now;
    writeWaitlist(waitlist);

    return { created: false, entry: existingEntry };
  }

  const entry = {
    id: randomUUID(),
    email,
    source: sourceName,
    status: 1,
    registrationCodeStatus: 0,
    submissionCount: 1,
    ipHash: hashValue(ipAddress || ''),
    userAgent: userAgent.slice(0, 300),
    createdAt: now,
    updatedAt: now,
    lastSubmittedAt: now
  };

  waitlist.entries.push(entry);
  waitlist.updatedAt = now;
  writeWaitlist(waitlist);

  return { created: true, entry };
}

function readWaitlist() {
  if (!existsSync(waitlistFile)) {
    return createEmptyWaitlist();
  }

  const parsed = JSON.parse(readFileSync(waitlistFile, 'utf-8'));

  return {
    version: 1,
    createdAt: parsed.createdAt || new Date().toISOString(),
    updatedAt: parsed.updatedAt || new Date().toISOString(),
    entries: Array.isArray(parsed.entries) ? parsed.entries : []
  };
}

function writeWaitlist(waitlist) {
  mkdirSync(dirname(waitlistFile), { recursive: true });

  const tmpFile = `${waitlistFile}.${process.pid}.tmp`;
  writeFileSync(tmpFile, `${JSON.stringify(waitlist, null, 2)}\n`, 'utf-8');
  renameSync(tmpFile, waitlistFile);
}

function createEmptyWaitlist() {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    entries: []
  };
}

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadLocalEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
