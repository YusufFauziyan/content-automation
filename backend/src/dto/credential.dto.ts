/**
 * One encrypted value, in the three parts decryption needs.
 *
 * Lives with the DTOs rather than with the service that produces it: the
 * repository stores this shape and the service creates it, and neither layer is
 * allowed to import the other.
 */
export interface SealedSecret {
  readonly cipherText: string;
  readonly iv: string;
  readonly tag: string;
}

/** Platforms a finished video can be published to. */
export enum CredentialPlatform {
  TikTok = 'TIKTOK',
  Instagram = 'INSTAGRAM',
  Threads = 'THREADS',
  YouTube = 'YOUTUBE',
}

/**
 * How the uploader proves it may publish as this account.
 *
 * The distinction is not cosmetic: the two carry different secrets and fail in
 * different ways. `Api` holds OAuth tokens the platform issued and will refresh;
 * `Browser` holds a captured web session, which no one refreshes and which
 * expires without telling anybody. A caller that cannot see which it has cannot
 * report the difference to an operator.
 */
export enum CredentialAuthMethod {
  /** The platform's own posting API. */
  Api = 'API',
  /** A browser session driven by Playwright. */
  Browser = 'BROWSER',
}

/**
 * A sealed credential together with enough context to interpret it.
 *
 * The ciphertext alone is not enough for a caller to act on: opening it yields
 * a JSON object whose meaning depends on how the account was connected. Handing
 * back the method with the bytes removes the guess.
 */
export interface SealedCredential {
  readonly authMethod: CredentialAuthMethod;
  readonly fieldNames: readonly string[];
  readonly sealed: SealedSecret;
}

/**
 * A stored account, as anything outside the server may see it.
 *
 * Carries no secret and no way to obtain one. `fieldNames` says *what* is held
 * — `accessToken`, `refreshToken` — so the UI can show that a credential is
 * complete without any part of it being sent.
 */
export interface CredentialDto {
  readonly id: string;
  readonly platform: CredentialPlatform;
  readonly authMethod: CredentialAuthMethod;
  readonly label: string;
  readonly fieldNames: readonly string[];
  readonly enabled: boolean;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * How a sign-in capture is going.
 *
 * In memory only, and deliberately so: a capture is one open browser window in
 * one process. Persisting it would outlive the window it describes, and a
 * `WAITING` row pointing at a browser that closed hours ago is worse than no
 * row at all.
 */
export enum CaptureStatus {
  /** A browser is open and nobody has finished signing in yet. */
  Waiting = 'WAITING',
  /** Signed in; the session is being sealed and stored. */
  Saving = 'SAVING',
  /** Stored. The account is connected. */
  Saved = 'SAVED',
  /** Gave up — timed out, closed, or no display to open a browser on. */
  Failed = 'FAILED',
}

/** A capture as the UI polls it. Never carries the session itself. */
export interface CaptureStateDto {
  readonly id: string;
  readonly status: CaptureStatus;
  /** Why it failed, in words meant for the person who clicked the button. */
  readonly message: string | null;
  readonly credentialId: string | null;
}

/**
 * Opening a browser and waiting for a person to sign in.
 *
 * Declared with the DTOs rather than with the service that implements it, so
 * the use case can depend on the capability without importing the service
 * layer — the same reason {@link SealedSecret} lives here.
 */
export interface SessionCapturer {
  /**
   * Opens a visible browser at the platform's login page and resolves with the
   * session once someone has signed in.
   *
   * @throws When there is no display, the window was closed, or nobody signed
   *   in before `timeoutMs` elapsed.
   */
  captureSession(timeoutMs: number): Promise<string>;
}

/** What a caller supplies when connecting an account. */
export interface NewCredentialDto {
  readonly platform: CredentialPlatform;
  readonly authMethod: CredentialAuthMethod;
  readonly label: string;
  /** Field name to value. Encrypted as one blob; never stored in the clear. */
  readonly fields: Readonly<Record<string, string>>;
}
