// Registra os reducers de e-mail no projetor enquanto project.mjs não os importa direto.
import { registerReducer } from '../store/project.mjs';
import { reducersEmail } from './reducer.mjs';

export function registrarReducersEmail() {
  for (const [tipo, reducer] of Object.entries(reducersEmail)) registerReducer(tipo, reducer);
}
