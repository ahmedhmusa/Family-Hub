// Shared Supabase bootstrap — used by both the Parent App and Kids App.
// Looks for a saved {url, anonKey} in localStorage; if missing, the app
// shows a one-time "Connect to Supabase" screen (see connectScreen()).
// The anon key is safe to store client-side by design — Supabase's
// row-level security (see supabase/schema.sql) is what actually protects
// the data, not secrecy of this key.

const SB_CONFIG_KEY = "fsd:supabaseConfig";

function getSupabaseConfig() {
  try {
    const raw = localStorage.getItem(SB_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setSupabaseConfig(url, anonKey) {
  localStorage.setItem(SB_CONFIG_KEY, JSON.stringify({ url, anonKey }));
}

function clearSupabaseConfig() {
  localStorage.removeItem(SB_CONFIG_KEY);
}

let _client = null;
function getClient() {
  if (_client) return _client;
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  _client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return _client;
}

// A second, isolated client used only for creating a CHILD's auth
// account from inside the Parent App without disturbing the parent's
// own signed-in session (supabase-js keeps one session per client
// instance, keyed by storageKey).
function getIsolatedClient() {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  return window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "fsd:temp-signup-session" }
  });
}

window.SupabaseBootstrap = { getSupabaseConfig, setSupabaseConfig, clearSupabaseConfig, getClient, getIsolatedClient };
