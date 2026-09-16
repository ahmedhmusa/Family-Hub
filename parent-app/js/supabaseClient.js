// Shared Supabase bootstrap — used by both the Parent App and Kids App.
// Looks for a saved {url, anonKey} in localStorage; falls back to the
// DEFAULT_CONFIG below (the family's actual Supabase project) so the app
// connects automatically with no setup step. The anon key is safe to ship
// client-side by design — Supabase's row-level security (see
// supabase/schema.sql) is what actually protects the data, not secrecy of
// this key. To point at a different project later, use "Change Supabase
// connection" in the app, which overrides this default via localStorage.

const SB_CONFIG_KEY = "fsd:supabaseConfig";
const DEFAULT_CONFIG = {
  url: "https://ajgjtehjyztlcdlgtrzt.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqZ2p0ZWhqeXp0bGNkbGd0cnp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MjQ3NzcsImV4cCI6MjEwNTEwMDc3N30.CsCCjobSW6XO2qjRnzJKZlyhY0rqDgO7Xg0kP1Vjdco"
};

function getSupabaseConfig() {
  try {
    const raw = localStorage.getItem(SB_CONFIG_KEY);
    if (raw === "CLEARED") return null; // user explicitly asked to reconnect elsewhere
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to default */ }
  return DEFAULT_CONFIG;
}

function setSupabaseConfig(url, anonKey) {
  localStorage.setItem(SB_CONFIG_KEY, JSON.stringify({ url, anonKey }));
}

function clearSupabaseConfig() {
  localStorage.setItem(SB_CONFIG_KEY, "CLEARED");
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
