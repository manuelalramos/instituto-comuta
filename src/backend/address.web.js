import { webMethod, Permissions } from 'wix-web-module';
import { fetch } from 'wix-fetch';

/**
 * @typedef {Object} ViaCepResponse
 * @property {string=} cep
 * @property {string=} logradouro
 * @property {string=} complemento
 * @property {string=} bairro
 * @property {string=} localidade
 * @property {string=} uf
 * @property {boolean=} erro
 */

export const lookupAddressByCep = webMethod(
  Permissions.Anyone,
  /**
   * @param {string} rawCep
   */
  async (rawCep) => {
    const cep = normalizeZipCode(rawCep);

    if (!/^\d{8}$/.test(cep)) {
      throw new Error('CEP invalido.');
    }

    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    const data = /** @type {ViaCepResponse} */ (await response.json());

    if (!response.ok || data?.erro) {
      throw new Error('CEP nao encontrado.');
    }

    return {
      zipCode: normalizeZipCode(data.cep),
      street: normalizeString(data.logradouro),
      complement: normalizeString(data.complemento),
      neighborhood: normalizeString(data.bairro),
      city: normalizeString(data.localidade),
      state: normalizeString(data.uf).toUpperCase()
    };
  }
);

/**
 * @param {unknown} value
 */
function normalizeZipCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

/**
 * @param {unknown} value
 */
function normalizeString(value) {
  return String(value || '').trim();
}
