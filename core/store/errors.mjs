// Erros de domínio com código estável, para a camada HTTP mapear em 400, 404 e 409.
export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
export const invalido = message => new DomainError('invalido', message);
export const naoEncontrado = message => new DomainError('nao_encontrado', message);
export const ocupado = message => new DomainError('ocupado', message);
