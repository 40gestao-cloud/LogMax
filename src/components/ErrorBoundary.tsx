// @ts-nocheck
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Sentry } from '../lib/sentry';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[LogMax] Render error:', error, info?.componentStack);
    // Envia para o Sentry com o componentStack como contexto adicional
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info?.componentStack ?? '' } },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
          <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-300">Erro ao carregar módulo</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-sm">
              Ocorreu um erro inesperado. Tente navegar para outro módulo ou recarregue a página.
            </p>
            {this.state.error && (
              <p className="text-xs text-gray-600 mt-2 font-mono">{this.state.error.message}</p>
            )}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="neu-button px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-accent transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
