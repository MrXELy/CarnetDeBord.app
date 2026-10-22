import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Filet de sécurité : si un écran plante, on affiche un message et un bouton pour recharger
 * au lieu d'une page noire. Les étapes déjà enregistrées sont gardées sur l'appareil.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="login error-screen">
        <span className="error-icon" aria-hidden>
          <TriangleAlert size={36} />
        </span>
        <h1>Oups, un problème</h1>
        <p className="muted">
          L’appli a rencontré une erreur. Tes étapes déjà enregistrées sont gardées sur l’appareil ; seule la saisie en
          cours a pu être perdue.
        </p>
        <p className="form-message">{error.message}</p>
        <button className="btn-primary" onClick={() => location.reload()}>
          Recharger l’appli
        </button>
      </main>
    );
  }
}
