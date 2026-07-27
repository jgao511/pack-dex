import {
  MOBILE_ONBOARDING_DESTINATION,
  clearGuestTutorialPack,
  clearPendingMobileOnboarding,
  inspectPendingMobileOnboarding,
  markMobileOnboardingComplete,
  updatePendingMobileOnboardingStatus,
} from "./mobileOnboarding.js";

const DEFAULT_SESSION_ATTEMPTS = 8;
const DEFAULT_SESSION_INTERVAL_MS = 75;

export class MobileOnboardingError extends Error {
  constructor(message, {
    code = "onboarding_sync_failed",
    httpStatus = 0,
    body = null,
    retryable = false,
    kind = "server_migration_failure",
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "MobileOnboardingError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.body = body;
    this.retryable = retryable;
    this.kind = kind;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export function getMobileOnboardingErrorPresentation(error) {
  const normalized = error instanceof MobileOnboardingError
    ? error
    : new MobileOnboardingError(
        "Your account is ready, but we could not save your first pack yet.",
        { retryable: true, cause: error }
      );

  return {
    httpStatus: normalized.httpStatus,
    body: normalized.body,
    code: normalized.code,
    retryable: normalized.retryable,
    kind: normalized.kind,
    message: normalized.message,
  };
}

async function readFunctionError(error) {
  const response = error?.context;
  let body = null;

  if (response && typeof response.clone === "function") {
    try {
      body = await response.clone().json();
    } catch {
      try {
        body = { message: await response.clone().text() };
      } catch {
        body = null;
      }
    }
  }

  const httpStatus = Number(response?.status || error?.status || 0);
  const code = String(body?.code || error?.code || (httpStatus === 401 ? "unauthorized" : "onboarding_sync_failed"));
  const retryable = typeof body?.retryable === "boolean"
    ? body.retryable
    : httpStatus === 0 || httpStatus >= 500 || httpStatus === 429;
  const kind = httpStatus === 401
    ? code === "session_expired" ? "expired_session" : "unauthorized_function_request"
    : httpStatus === 0 ? "network_interruption" : "server_migration_failure";
  const message = httpStatus === 401
    ? "Your session expired. Please sign in again."
    : "Your account is ready, but we could not save your first pack yet.";

  return new MobileOnboardingError(message, {
    code,
    httpStatus,
    body,
    retryable,
    kind,
    cause: error,
  });
}

export async function waitForAuthenticatedMobileSession(
  client,
  {
    attempts = DEFAULT_SESSION_ATTEMPTS,
    intervalMs = DEFAULT_SESSION_INTERVAL_MS,
    waitFn = wait,
  } = {}
) {
  if (!client?.auth) {
    throw new MobileOnboardingError("PackDex account services are unavailable.", {
      code: "auth_unavailable",
      kind: "unauthorized_function_request",
    });
  }

  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) lastError = sessionError;

    const session = sessionData?.session || null;
    if (session?.user?.id) {
      const { data: userData, error: userError } = typeof client.auth.getUser === "function"
        ? await client.auth.getUser()
        : { data: { user: session.user }, error: null };
      if (!userError && userData?.user?.id === session.user.id) {
        return { session, user: userData.user };
      }
      lastError = userError || new Error("Authenticated user did not match the active session.");
    }

    if (attempt < attempts - 1) await waitFn(intervalMs);
  }

  throw new MobileOnboardingError("Your session expired. Please sign in again.", {
    code: "session_expired",
    httpStatus: 401,
    retryable: false,
    kind: "expired_session",
    cause: lastError,
  });
}

async function invokeOnboardingCompletion(client, pending) {
  let result;
  try {
    result = await client.functions.invoke("complete-mobile-onboarding", {
      body: {
        version: pending.version,
        completion_id: pending.completionId,
        set_id: pending.setId,
        card_ids: pending.cardIds,
        tutorial_pack_event_id: pending.tutorialPackEventId,
        skipped: pending.skipped,
      },
    });
  } catch (error) {
    throw new MobileOnboardingError(
      "Your account is ready, but we could not save your first pack yet.",
      {
        code: "network_interruption",
        retryable: true,
        kind: "network_interruption",
        cause: error,
      }
    );
  }

  if (result?.error) throw await readFunctionError(result.error);

  const data = result?.data || {};
  const status = String(data.status || "");
  const succeeded =
    data.ok === true &&
    (status === "completed" || status === "already_completed");
  const legacySucceeded = data.completed === true || data.alreadyCompleted === true;
  if (!succeeded && !legacySucceeded) {
    throw new MobileOnboardingError(
      "Your account is ready, but we could not save your first pack yet.",
      {
        code: String(data.code || "invalid_completion_response"),
        body: data,
        retryable: true,
      }
    );
  }

  return {
    ...data,
    ok: true,
    status: status || (data.alreadyCompleted ? "already_completed" : "completed"),
  };
}

export async function finalizeMobileOnboarding({
  client,
  storage = globalThis.localStorage,
  allowNoPending = false,
  refreshData = async () => {},
  onLocalComplete = () => {},
  navigate = (destination) => globalThis.location?.replace?.(destination),
  sessionOptions,
} = {}) {
  const { user } = await waitForAuthenticatedMobileSession(client, sessionOptions);
  const pendingInspection = inspectPendingMobileOnboarding(storage);
  const pending = pendingInspection.payload;

  if (!pending) {
    if (!allowNoPending) {
      const issue = pendingInspection.reason === "expired"
        ? "expired_pending_payload"
        : pendingInspection.reason === "malformed"
          ? "malformed_pending_payload"
          : "missing_pending_payload";
      throw new MobileOnboardingError(
        pendingInspection.reason === "expired"
          ? "Your saved tutorial pack expired. Please replay onboarding to save a first pack."
          : pendingInspection.reason === "malformed"
            ? "Your saved tutorial pack could not be read safely. Please replay onboarding."
          : "Your account is ready, but the tutorial pack is missing.",
        {
          code: issue,
          retryable: false,
          kind: "missing_pending_tutorial_payload",
        }
      );
    }

    await refreshData(user, { ok: true, status: "no_pending", tutorialPackSaved: false });
    markMobileOnboardingComplete(storage);
    onLocalComplete({ user, result: { ok: true, status: "no_pending", tutorialPackSaved: false } });
    navigate(MOBILE_ONBOARDING_DESTINATION);
    return { ok: true, status: "no_pending", tutorialPackSaved: false, user };
  }

  updatePendingMobileOnboardingStatus("syncing", storage);

  let result;
  try {
    result = await invokeOnboardingCompletion(client, pending);
    await refreshData(user, result);
  } catch (error) {
    updatePendingMobileOnboardingStatus("failed", storage);
    throw error;
  }

  markMobileOnboardingComplete(storage);
  clearPendingMobileOnboarding(storage);
  clearGuestTutorialPack(storage);
  onLocalComplete({ user, result });
  navigate(pending.destination || MOBILE_ONBOARDING_DESTINATION);
  return { ...result, user };
}
