import { createPixCharge, getPixStatus } from 'backend/pix.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';

/** @type {string | null} */
let currentDonationId = null;
/** @type {string} */
let currentPixCode = '';
/** @type {string} */
let currentTicketUrl = '';
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;

$w.onReady(function () {
  const textoInicial = 'Clique acima para copiar o Pix';

  $w('#ajudaPix').text = textoInicial;

  const copiarPixFixo = async () => {
    try {
      await wixWindowFrontend.copyToClipboard('doe@institutocomuta.org.br');
      $w('#ajudaPix').text = 'Pix copiado';
    } catch (error) {
      console.log('Erro ao copiar Pix:', error);
      $w('#ajudaPix').text = 'Nao foi possivel copiar o Pix';
    }

    setTimeout(() => {
      $w('#ajudaPix').text = textoInicial;
    }, 2000);
  };

  registrarAcaoDeToque('#btnCopiarPix', copiarPixFixo);
  registrarAcaoDeToque('#ajudaPix', copiarPixFixo);
  registrarAcaoDeToque('#text2', copiarPixFixo);

  prepararTela();
  configurarBotoesDeValor();
  configurarBotaoGerar();
  configurarCliqueNoCodigo();
});

/**
 * Registra clique e toque para cobrir melhor o comportamento no mobile da Wix.
 * @param {string} seletor
 * @param {() => void | Promise<void>} acao
 */
function registrarAcaoDeToque(seletor, acao) {
  const elemento = $w(seletor);
  elemento.onClick(acao);

  if (typeof elemento.onPress === 'function') {
    elemento.onPress(acao);
  }
}

function prepararTela() {
  $w('#inputValor').value = '';
  $w('#inputEmail').value = '';

  $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
  $w('#txtPix').text = '';
  $w('#txtStatus').text = '';
  $w('#txtExpiracao').text = '';
  $w('#txtAjuda').text = '';
  $w('#txtLinkPix').text = '';

  $w('#imgQr').hide();
  $w('#imgQr').collapse();

  $w('#txtPix').hide();
  $w('#txtPix').collapse();

  $w('#txtAjuda').hide();
  $w('#txtAjuda').collapse();

  $w('#txtStatus').hide();
  $w('#txtStatus').collapse();

  $w('#txtExpiracao').hide();
  $w('#txtExpiracao').collapse();

  $w('#txtLinkPix').hide();
  $w('#txtLinkPix').collapse();
}

function configurarBotoesDeValor() {
  registrarAcaoDeToque('#btn20', () => selecionarValor('20'));
  registrarAcaoDeToque('#btn30', () => selecionarValor('30'));
  registrarAcaoDeToque('#btn50', () => selecionarValor('50'));
  registrarAcaoDeToque('#btn100', () => selecionarValor('100'));
}

/**
 * @param {string} valor
 */
function selecionarValor(valor) {
  $w('#inputValor').value = valor;
  $w('#txtMensagem').text = `Valor selecionado: R$${valor},00`;
}

function configurarBotaoGerar() {
  registrarAcaoDeToque('#btnGerarPix', async () => {
    const amountRaw = String($w('#inputValor').value || '').trim();
    const email = String($w('#inputEmail').value || '').trim();
    const amount = Number(amountRaw.replace(',', '.'));

    limparResultado();
    $w('#txtMensagem').text = 'Gerando QR Code...';

    if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
      await $w('#inputValor').scrollTo();
      $w('#inputValor').focus();
      $w('#txtMensagem').text = 'Digite um valor valido para continuar';
      return;
    }

    if (!email || !email.includes('@') || !email.includes('.')) {
      await $w('#inputEmail').scrollTo();
      $w('#inputEmail').focus();
      $w('#txtMensagem').text = 'Digite um email valido para gerar o pagamento';
      return;
    }

    try {
      const result = await createPixCharge({ amount, email });
      console.log('RESULTADO FRONT:', result);

      currentDonationId = result.donationId || null;
      currentPixCode = result.pixCode || '';
      currentTicketUrl = result.ticketUrl || '';

      if (result.qrCodeImage) {
        $w('#imgQr').src = result.qrCodeImage;
        $w('#imgQr').expand();
        $w('#imgQr').show();
      }

      if (currentTicketUrl) {
        $w('#txtPix').text = '';
        $w('#txtPix').hide();
        $w('#txtPix').collapse();

        $w('#txtLinkPix').text = 'Abrir pagamento no Mercado Pago';
        $w('#txtLinkPix').expand();
        $w('#txtLinkPix').show();

        $w('#txtAjuda').text = 'Toque no link do Mercado Pago ou leia o QR Code';
        $w('#txtAjuda').expand();
        $w('#txtAjuda').show();
      } else if (currentPixCode) {
        $w('#txtPix').text = currentPixCode;
        $w('#txtPix').expand();
        $w('#txtPix').show();

        $w('#txtAjuda').text = 'Clique no codigo para copiar ou leia o QR Code';
        $w('#txtAjuda').expand();
        $w('#txtAjuda').show();
      }

      if (result.status) {
        $w('#txtStatus').text = 'Status: ' + traduzirStatus(result.status);
        $w('#txtStatus').expand();
        $w('#txtStatus').show();
      }

      if (result.expiresAt) {
        $w('#txtExpiracao').text =
          'Expira em: ' + new Date(result.expiresAt).toLocaleString('pt-BR');
        $w('#txtExpiracao').expand();
        $w('#txtExpiracao').show();
      }

      $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
      iniciarConsultaStatus();
    } catch (error) {
      console.log('Erro ao gerar PIX:', error);
      $w('#txtMensagem').text = 'Erro ao gerar PIX';
    }
  });
}

function configurarCliqueNoCodigo() {
  registrarAcaoDeToque('#txtPix', async () => {
    await copiarCodigoPix();
  });

  registrarAcaoDeToque('#txtLinkPix', () => {
    abrirLinkPix();
  });
}

async function copiarCodigoPix() {
  if (!currentPixCode) return;

  try {
    await wixWindowFrontend.copyToClipboard(currentPixCode);
    $w('#txtAjuda').text = 'Codigo copiado com sucesso.';
  } catch (error) {
    console.log('Falha ao copiar:', error);
    $w('#txtAjuda').text = 'Nao foi possivel copiar automaticamente.';
  }

  $w('#txtAjuda').expand();
  $w('#txtAjuda').show();
}

function abrirLinkPix() {
  if (!currentTicketUrl) return;

  wixLocationFrontend.to(currentTicketUrl);
}

function limparResultado() {
  currentDonationId = null;
  currentPixCode = '';
  currentTicketUrl = '';

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  $w('#imgQr').hide();
  $w('#imgQr').collapse();

  $w('#txtPix').text = '';
  $w('#txtPix').hide();
  $w('#txtPix').collapse();

  $w('#txtAjuda').text = '';
  $w('#txtAjuda').hide();
  $w('#txtAjuda').collapse();

  $w('#txtStatus').text = '';
  $w('#txtStatus').hide();
  $w('#txtStatus').collapse();

  $w('#txtExpiracao').text = '';
  $w('#txtExpiracao').hide();
  $w('#txtExpiracao').collapse();

  $w('#txtLinkPix').text = '';
  $w('#txtLinkPix').hide();
  $w('#txtLinkPix').collapse();
}

function iniciarConsultaStatus() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(async () => {
    if (!currentDonationId) return;

    try {
      const result = await getPixStatus(currentDonationId);
      console.log('STATUS FRONT:', result);

      if (result && result.status) {
        $w('#txtStatus').text = 'Status: ' + traduzirStatus(result.status);
        $w('#txtStatus').expand();
        $w('#txtStatus').show();
      }
    } catch (error) {
      console.log('Erro ao consultar status:', error);
    }
  }, 15000);
}

/**
 * @param {string} status
 */
function traduzirStatus(status) {
  if (status === 'approved') return 'pago';
  if (status === 'pending') return 'aguardando pagamento';
  if (status === 'in_process') return 'em processamento';
  if (status === 'rejected') return 'rejeitado';
  if (status === 'cancelled') return 'cancelado';
  return status;
}
