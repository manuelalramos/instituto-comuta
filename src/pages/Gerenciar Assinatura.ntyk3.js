import {
  findDonationSubscriptionsByEmail,
  cancelDonationSubscriptionForEmail
} from 'backend/subscriptions.web';

/**
 * IDs esperados nesta pagina:
 * - #inputSubscriptionEmail
 * - #btnLoadSubscriptions
 * - #btnRefreshSubscriptions (opcional)
 * - #txtSubscriptionsStatus
 * - #boxSubscriptionsEmpty (opcional)
 * - #repeaterSubscriptions
 *
 * Dentro do repeater:
 * - #txtSubscriptionReason
 * - #txtSubscriptionMeta
 * - #txtSubscriptionAmount
 * - #txtSubscriptionStatus
 * - #txtSubscriptionStatusActive
 * - #txtSubscriptionStatusCancel
 * - #btnCancelSubscription
 */

/** @type {Array<any>} */
let currentSubscriptions = [];
/** @type {string} */
let currentEmail = '';
/** @type {boolean} */
let isLoadingSubscriptions = false;
/** @type {boolean} */
let isCancellingSubscription = false;

$w.onReady(function () {
  prepararPaginaAssinaturas();
  configurarBuscaAssinaturas();
  configurarAtualizacaoAssinaturas();
  configurarRepeaterAssinaturas();
});

function prepararPaginaAssinaturas() {
  setSubscriptionsStatus('Informe seu email para localizar suas assinaturas.');
  hideAndCollapseIfExists('#boxSubscriptionsEmpty');
  hideAndCollapseIfExists('#repeaterSubscriptions');
}

function configurarBuscaAssinaturas() {
  registrarCliqueOpcional('#btnLoadSubscriptions', async () => {
    await carregarAssinaturas();
  });
}

function configurarAtualizacaoAssinaturas() {
  registrarCliqueOpcional('#btnRefreshSubscriptions', async () => {
    await carregarAssinaturas();
  });
}

function configurarRepeaterAssinaturas() {
  const repeater = getOptionalElement('#repeaterSubscriptions');
  if (!repeater || typeof repeater.onItemReady !== 'function') {
    return;
  }

  repeater.onItemReady(($item, itemData) => {
    setItemText($item, '#txtSubscriptionReason', getSubscriptionDisplayTitle(itemData));
    setItemText($item, '#txtSubscriptionMeta', getSubscriptionMeta(itemData));
    setItemText($item, '#txtSubscriptionAmount', formatCurrency(itemData.amount || 0));
    setItemText($item, '#txtSubscriptionStatus', getSubscriptionStatusLabel(itemData.status));
    syncSubscriptionStatusBadges($item, itemData.status);

    const cancelButton = getRepeaterItemElement($item, '#btnCancelSubscription');
    if (cancelButton) {
      const canCancel = canCancelSubscription(itemData.status) && !isCancellingSubscription;

      if ('label' in cancelButton) {
        cancelButton.label = canCancel ? 'Cancelar assinatura' : 'Assinatura encerrada';
      }

      if (canCancel && typeof cancelButton.enable === 'function') {
        cancelButton.enable();
      }

      if (!canCancel && typeof cancelButton.disable === 'function') {
        cancelButton.disable();
      }

      if (typeof cancelButton.onClick === 'function') {
        cancelButton.onClick(async () => {
          await cancelarAssinatura(itemData);
        });
      }
    }
  });
}

/**
 * @param {any} $item
 * @param {string} status
 */
function syncSubscriptionStatusBadges($item, status) {
  const normalizedStatus = normalizeString(status).toLowerCase();
  const isCancelled = normalizedStatus === 'cancelled';
  const isActive = normalizedStatus === 'authorized';

  toggleRepeaterItemVisibility($item, '#txtSubscriptionStatusActive', isActive);
  toggleRepeaterItemVisibility($item, '#txtSubscriptionStatusCancel', isCancelled);
}

async function carregarAssinaturas() {
  if (isLoadingSubscriptions) {
    return;
  }

  const email = getNormalizedSubscriptionEmail();
  if (!isValidEmail(email)) {
    setSubscriptionsStatus('Informe um email valido para localizar suas assinaturas.');
    await focusIfExists('#inputSubscriptionEmail');
    return;
  }

  isLoadingSubscriptions = true;
  currentEmail = email;
  setLoadSubscriptionsAvailable(false);
  setSubscriptionsStatus('Buscando suas assinaturas...');

  try {
    const subscriptions = await findDonationSubscriptionsByEmail(email);
    currentSubscriptions = Array.isArray(subscriptions) ? subscriptions : [];
    renderSubscriptions();
  } catch (error) {
    currentSubscriptions = [];
    renderSubscriptions();
    setSubscriptionsStatus(getErrorMessage(error) || 'Nao foi possivel localizar suas assinaturas.');
  } finally {
    isLoadingSubscriptions = false;
    setLoadSubscriptionsAvailable(true);
  }
}

/**
 * @param {any} itemData
 */
async function cancelarAssinatura(itemData) {
  if (isCancellingSubscription) {
    return;
  }

  const subscriptionId = normalizeString(itemData?.subscriptionId);
  if (!subscriptionId || !isValidEmail(currentEmail)) {
    setSubscriptionsStatus('Nao foi possivel identificar a assinatura para cancelamento.');
    return;
  }

  isCancellingSubscription = true;
  setSubscriptionsStatus('Cancelando assinatura...');

  try {
    await cancelDonationSubscriptionForEmail({
      email: currentEmail,
      subscriptionId
    });

    setSubscriptionsStatus('Assinatura cancelada com sucesso.');
    await carregarAssinaturas();
  } catch (error) {
    setSubscriptionsStatus(getErrorMessage(error) || 'Nao foi possivel cancelar a assinatura.');
  } finally {
    isCancellingSubscription = false;
  }
}

function renderSubscriptions() {
  const repeater = getOptionalElement('#repeaterSubscriptions');
  const emptyBox = getOptionalElement('#boxSubscriptionsEmpty');

  if (currentSubscriptions.length === 0) {
    hideAndCollapseIfExists('#repeaterSubscriptions');

    if (emptyBox) {
      showAndExpandIfExists('#boxSubscriptionsEmpty');
    }

    setSubscriptionsStatus('Nenhuma assinatura encontrada para este email.');
    return;
  }

  hideAndCollapseIfExists('#boxSubscriptionsEmpty');

  if (repeater && 'data' in repeater) {
    repeater.data = currentSubscriptions.map((item, index) => ({
      _id: normalizeString(item.subscriptionId || item.externalReference || `subscription-${index}`),
      ...item
    }));
    showAndExpandIfExists('#repeaterSubscriptions');
  }

  setSubscriptionsStatus(`${currentSubscriptions.length} assinatura(s) encontrada(s).`);
}

function setLoadSubscriptionsAvailable(isAvailable) {
  toggleButtonAvailability('#btnLoadSubscriptions', isAvailable);
  toggleButtonAvailability('#btnRefreshSubscriptions', isAvailable);
}

/**
 * @param {string} selector
 * @param {boolean} isAvailable
 */
function toggleButtonAvailability(selector, isAvailable) {
  const button = getOptionalElement(selector);
  if (!button) {
    return;
  }

  if (isAvailable && typeof button.enable === 'function') {
    button.enable();
  }

  if (!isAvailable && typeof button.disable === 'function') {
    button.disable();
  }
}

function getNormalizedSubscriptionEmail() {
  return normalizeString(getInputValueIfExists('#inputSubscriptionEmail')).toLowerCase();
}

/**
 * @param {any} itemData
 */
function getSubscriptionDisplayTitle(itemData) {
  return (
    normalizeString(itemData?.reason) ||
    normalizeString(itemData?.title) ||
    'Assinatura Instituto Comuta'
  );
}

/**
 * @param {any} itemData
 */
function getSubscriptionMeta(itemData) {
  const recurrence = getSubscriptionRecurrenceLabel(itemData?.recurrence);
  const createdAt = formatDate(itemData?.dateCreatedMp);
  const reference = normalizeString(itemData?.externalReference);

  return [recurrence, createdAt ? `Criada em ${createdAt}` : '', reference].filter(Boolean).join(' | ');
}

/**
 * @param {string} recurrence
 */
function getSubscriptionRecurrenceLabel(recurrence) {
  if (recurrence === 'weekly') return 'Semanal';
  if (recurrence === 'monthly') return 'Mensal';
  if (recurrence === 'yearly') return 'Anual';
  return 'Recorrente';
}

/**
 * @param {string} status
 */
function getSubscriptionStatusLabel(status) {
  if (status === 'authorized') return 'Ativa';
  if (status === 'pending') return 'Pendente';
  if (status === 'paused') return 'Pausada';
  if (status === 'cancelled') return 'Cancelada';
  return normalizeString(status) || 'Sem status';
}

/**
 * @param {string} status
 */
function canCancelSubscription(status) {
  return status !== 'cancelled';
}

/**
 * @param {string} text
 */
function setSubscriptionsStatus(text) {
  const statusText = getOptionalElement('#txtSubscriptionsStatus');
  if (statusText && 'text' in statusText) {
    statusText.text = text;
    return;
  }

  const page = getOptionalElement('#page1');
  if (page && 'title' in page) {
    page.title = text;
  }
}

/**
 * @param {any} $item
 * @param {string} selector
 * @param {string} text
 */
function setItemText($item, selector, text) {
  const element = getRepeaterItemElement($item, selector);
  if (element && 'text' in element) {
    element.text = text;
  }
}

/**
 * @param {any} $item
 * @param {string} selector
 * @param {boolean} isVisible
 */
function toggleRepeaterItemVisibility($item, selector, isVisible) {
  const element = getRepeaterItemElement($item, selector);
  if (!element) {
    return;
  }

  if (isVisible) {
    if (typeof element.expand === 'function') {
      element.expand();
    }

    if (typeof element.show === 'function') {
      element.show();
    }

    return;
  }

  if (typeof element.hide === 'function') {
    element.hide();
  }

  if (typeof element.collapse === 'function') {
    element.collapse();
  }
}

/**
 * @param {any} $item
 * @param {string} selector
 * @returns {any}
 */
function getRepeaterItemElement($item, selector) {
  try {
    return $item(selector);
  } catch (error) {
    return null;
  }
}

/**
 * @param {string} selector
 * @param {() => void | Promise<void>} action
 */
function registrarCliqueOpcional(selector, action) {
  const element = getOptionalElement(selector);
  if (!element || typeof element.onClick !== 'function') {
    return;
  }

  element.onClick(() => action());
}

/**
 * @param {string} selector
 * @returns {any}
 */
function getOptionalElement(selector) {
  try {
    return $w(selector);
  } catch (error) {
    return null;
  }
}

/**
 * @param {string} selector
 */
function hideAndCollapseIfExists(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return;
  }

  if (typeof element.hide === 'function') {
    element.hide();
  }

  if (typeof element.collapse === 'function') {
    element.collapse();
  }
}

/**
 * @param {string} selector
 */
function showAndExpandIfExists(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return;
  }

  if (typeof element.expand === 'function') {
    element.expand();
  }

  if (typeof element.show === 'function') {
    element.show();
  }
}

/**
 * @param {string} selector
 */
async function focusIfExists(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return;
  }

  if (typeof element.scrollTo === 'function') {
    await element.scrollTo();
  }

  if (typeof element.focus === 'function') {
    element.focus();
  }
}

/**
 * @param {string} selector
 */
function getInputValueIfExists(selector) {
  const element = getOptionalElement(selector);
  if (!element || !('value' in element)) {
    return '';
  }

  return element.value;
}

/**
 * @param {number} amount
 */
function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * @param {string | Date | null | undefined} value
 */
function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('pt-BR');
}

/**
 * @param {unknown} value
 */
function normalizeString(value) {
  return String(value || '').trim();
}

/**
 * @param {string} email
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @param {unknown} error
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return normalizeString(error.message);
  }

  return normalizeString(error) || 'Erro desconhecido';
}
