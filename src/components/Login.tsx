import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setMessage(translateError(error.message));
    else if (mode === 'signup' && !data.session) setMessage('Compte créé : confirme ton adresse depuis l’email reçu.');
  }

  return (
    <main className="login">
      <img className="login-logo" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />
      <h1>CarnetDeBord.app</h1>
      <p className="muted">Le suivi de tes trajets, semaine après semaine.</p>
      <form onSubmit={submit} className="login-form">
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && <p className="form-message">{message}</p>}
        <button className="btn-primary" disabled={busy}>
          {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
        </button>
      </form>
      <button className="btn-link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Première utilisation ? Créer un compte' : 'J’ai déjà un compte'}
      </button>
    </main>
  );
}

function translateError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Email ou mot de passe incorrect.';
  if (/already registered/i.test(msg)) return 'Un compte existe déjà avec cet email.';
  if (/fetch/i.test(msg)) return 'Pas de connexion internet.';
  return msg;
}
