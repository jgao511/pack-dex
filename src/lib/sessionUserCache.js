const USER_FRESH_MS = 5 * 60 * 1000;
const cacheByClient = new WeakMap();

export function getCachedSupabaseUser(supabaseClient, { force = false } = {}) {
  if (!supabaseClient) return Promise.resolve(null);
  const cached = cacheByClient.get(supabaseClient);
  if (!force && cached?.user && Date.now() - cached.loadedAt < USER_FRESH_MS) return Promise.resolve(cached.user);
  if (cached?.promise) return cached.promise;

  const promise = supabaseClient.auth.getUser()
    .then(({ data, error }) => {
      if (error) throw error;
      const user = data.user || null;
      cacheByClient.set(supabaseClient, { user, loadedAt: Date.now(), promise: null });
      return user;
    })
    .catch((error) => {
      cacheByClient.delete(supabaseClient);
      throw error;
    });
  cacheByClient.set(supabaseClient, { user: cached?.user || null, loadedAt: cached?.loadedAt || 0, promise });
  return promise;
}

export function clearCachedSupabaseUser(supabaseClient) {
  if (supabaseClient) cacheByClient.delete(supabaseClient);
}
