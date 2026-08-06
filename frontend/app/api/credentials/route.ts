import { NextResponse } from 'next/server';

import {
  connectCredential,
  deleteCredentials,
  listCredentials,
  type CredentialAuthMethod,
  type CredentialPlatform,
} from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

const PLATFORMS: CredentialPlatform[] = ['TIKTOK', 'INSTAGRAM', 'THREADS', 'YOUTUBE'];
const METHODS: CredentialAuthMethod[] = ['API', 'BROWSER'];

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ credentials: await listCredentials() });
  } catch (error) {
    return toReply(error);
  }
}

/**
 * Connects an account.
 *
 * The values pass straight through to the backend, which seals them before
 * anything is written. Nothing is logged here — a request body containing an
 * access token has no business in a log file.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { platform, authMethod, label, fields } = (await request.json().catch(() => ({}))) as {
    platform?: unknown;
    authMethod?: unknown;
    label?: unknown;
    fields?: unknown;
  };

  if (!PLATFORMS.includes(platform as CredentialPlatform)) {
    return NextResponse.json({ error: 'Pick a platform.' }, { status: 400 });
  }
  // Absent means the platform's own API — what every caller written before
  // browser sessions existed meant.
  const method = authMethod === undefined ? 'API' : (authMethod as CredentialAuthMethod);

  if (!METHODS.includes(method)) {
    return NextResponse.json({ error: 'Pick how the account signs in.' }, { status: 400 });
  }
  if (typeof label !== 'string' || label.trim() === '') {
    return NextResponse.json({ error: 'Give the account a handle.' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await connectCredential({
        platform: platform as CredentialPlatform,
        authMethod: method,
        label: label.trim(),
        fields: (fields ?? {}) as Record<string, string>,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toReply(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one account.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await deleteCredentials(ids as string[]));
  } catch (error) {
    return toReply(error);
  }
}
