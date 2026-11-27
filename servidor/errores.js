/** Error con código estable, para que la capa web lo traduzca a HTTP (403, 404, 409, 422). */
export class ErrorFinantia extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; this.name = 'ErrorFinantia'; }
}
export const NO_AUTORIZADO = 'NO_AUTORIZADO';
export const NO_ENCONTRADO = 'NO_ENCONTRADO';
export const ESTADO_INVALIDO = 'ESTADO_INVALIDO';
export const DATOS_INVALIDOS = 'DATOS_INVALIDOS';

export const falla = (codigo, mensaje) => { throw new ErrorFinantia(codigo, mensaje); };
